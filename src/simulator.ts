import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import pLimit from 'p-limit';
import { MSPNGame } from './game';
import { Agent, LLMModel } from './agent';
import { ReputationSystem } from './reputation';
import {
  EpisodeResult,
  ABTestMetrics,
  ProtocolLevel,
  ReviewAction,
  TrueState,
  StatisticalSignificance,
  ExperimentManifest,
  CorrectionMethod,
  StratifiedMetrics,
} from './types';
import {
  pairedTTest,
  bootstrapCI,
  cohensD,
  computeAchievedPower,
  computeRequiredSampleSize,
  correctPValues,
  familyWiseErrorRate,
  interpretEffectSize,
} from './stats';
import { KarmaStorage } from './karma/storage';
import {
  getManifestWarnings,
  loadExperimentManifest,
} from './analysis/manifest';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_ALPHA = 0.05;
const DEFAULT_TARGET_POWER = 0.8;
const DEFAULT_EXPECTED_EFFECT_SIZE = 0.5;
const MODEL_A_ID = 'google/gemini-2.5-flash-lite';
const MODEL_B_ID = 'mistralai/mistral-small-3.1-24b-instruct';

export interface RunABTestOptions {
  correctionMethod?: CorrectionMethod;
  manifest?: ExperimentManifest;
  resultsRoot?: string;
  saveResults?: boolean;
}

export interface AnalyzeEpisodeResultsOptions {
  correctionMethod?: CorrectionMethod;
  manifest?: ExperimentManifest;
  seed?: string;
}

export interface StoredRunArtifacts {
  baselineResults: EpisodeResult[];
  reputationResults: EpisodeResult[];
  manifest?: ExperimentManifest;
}

export interface ABTestRunResult {
  baseline: ABTestMetrics;
  withReputation: ABTestMetrics;
  significance: StatisticalSignificance | null;
  warnings: string[];
  manifest?: ExperimentManifest;
  runDir?: string;
}

/**
 * Simple async mutex for serializing reputation updates.
 */
class AsyncMutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// Load environment variables from .env file
config();

export async function runEpisode(
  episodeId: number,
  apiKey?: string,
  useReputation: boolean = false,
  seed?: string,
  reputationSystem: ReputationSystem | null = null
): Promise<EpisodeResult> {
  const episodeSeed = seed ? `${seed}-${episodeId}` : undefined;
  const game = new MSPNGame(episodeSeed);

  // Create agents with seeded RNG for reproducible mock behavior
  const modelA = new LLMModel(
    apiKey,
    MODEL_A_ID,
    episodeSeed ? `${episodeSeed}-A` : undefined
  );
  const modelB = new LLMModel(
    apiKey,
    MODEL_B_ID,
    episodeSeed ? `${episodeSeed}-B` : undefined
  );
  const agentA = new Agent('A', modelA);
  const agentB = new Agent('B', modelB);

  // Apply reputation consequences if enabled
  if (useReputation && reputationSystem) {
    const repA = reputationSystem.getModelReputation('model-A');
    const repB = reputationSystem.getModelReputation('model-B');
    agentA.setReputation(repA.karma);
    agentB.setReputation(repB.karma);
  }

  const maxRounds = 3;

  try {
    let roundCount = 0;
    let converged = false;

    for (let round = 0; round < maxRounds; round++) {
      roundCount = round + 1;

      // Phase 1: Proposal
      const state = game.getState();
      const opponentKarmaForA =
        useReputation && reputationSystem
          ? reputationSystem.getModelReputation('model-B').karma
          : undefined;
      const proposal = await agentA.act(
        'propose',
        state.agentBeliefs.a,
        state.history,
        undefined,
        opponentKarmaForA
      );

      // Apply reputation consequences
      const finalProposal = agentA.applyConsequences(
        proposal
      ) as ProtocolLevel;
      game.setProposal(finalProposal);

      // Phase 2: Review
      const reviewState = game.getState();
      const opponentKarmaForB =
        useReputation && reputationSystem
          ? reputationSystem.getModelReputation('model-A').karma
          : undefined;
      const reviewAction = await agentB.act(
        'review',
        reviewState.agentBeliefs.b,
        reviewState.history,
        reviewState.proposal,
        opponentKarmaForB
      );

      // Apply reputation consequences
      const finalReviewAction = agentB.applyConsequences(
        reviewAction
      ) as ReviewAction;
      game.setReview(finalReviewAction);

      // Check for agreement or final round
      if (game.isAgreement() || round === maxRounds - 1) {
        converged = game.isAgreement();
        break;
      }

      // No agreement yet and more rounds remain — reset for next round
      game.resetForNewRound();
    }

    // Phase 3: Execution (resolve the final proposal/review)
    const finalState = game.resolveExecution();

    // Apply payoff penalties
    let finalPayoffs = finalState.payoffs!;
    if (useReputation) {
      finalPayoffs = {
        a: agentA.applyPayoffPenalty(finalPayoffs.a),
        b: agentB.applyPayoffPenalty(finalPayoffs.b),
      };
    }

    const result: EpisodeResult = {
      episodeId,
      trueState: finalState.trueState,
      finalProtocol: finalState.finalProtocol,
      payoffs: finalPayoffs,
      history: finalState.history,
      agentBeliefs: finalState.agentBeliefs,
      reviewAction: finalState.reviewAction,
      roundCount,
      converged,
    };

    return result;
  } catch (error) {
    console.error(`Episode ${episodeId} failed:`, error);
    throw error;
  }
}

export async function runABTest(
  numEpisodes: number = 100,
  apiKey?: string,
  seed?: string,
  concurrency: number = DEFAULT_CONCURRENCY,
  options: RunABTestOptions = {}
): Promise<ABTestRunResult> {
  const effectiveConcurrency = Math.max(1, concurrency);
  console.log(
    `Starting A/B test with ${numEpisodes} episodes each (concurrency=${effectiveConcurrency})...`
  );

  // Run baseline (no reputation) — fully parallel
  console.log('Running baseline (no reputation)...');
  const limit = pLimit(effectiveConcurrency);
  let baselineCompleted = 0;

  const baselinePromises = Array.from({ length: numEpisodes }, (_, i) =>
    limit(async () => {
      try {
        const result = await runEpisode(i, apiKey, false, seed);
        baselineCompleted++;
        if (baselineCompleted % 10 === 0) {
          console.log(
            `Baseline: Completed ${baselineCompleted}/${numEpisodes} episodes`
          );
        }
        return result;
      } catch (error) {
        console.error(`Baseline episode ${i} failed:`, error);
        return null;
      }
    })
  );

  const baselineSettled = await Promise.all(baselinePromises);
  const baselineResults = baselineSettled.filter(
    (r): r is EpisodeResult => r !== null
  );

  // Run with reputation (shared system persists across episodes)
  // Episodes run in parallel; reputation reads/updates are serialized via mutex
  console.log('Running with reputation system...');
  const sharedReputationSystem = new ReputationSystem();
  const reputationMutex = new AsyncMutex();

  // Load persisted karma if available
  const karmaStorage = new KarmaStorage();
  if (karmaStorage.exists()) {
    const storedKarma = karmaStorage.load();
    if (storedKarma.size > 0) {
      const karmaRecord: Record<string, number> = {};
      for (const [id, karma] of storedKarma) {
        karmaRecord[id] = karma;
      }
      sharedReputationSystem.importReputations(karmaRecord);
      console.log(`  Loaded persisted karma for ${storedKarma.size} agents`);
    }
  }

  const repLimit = pLimit(effectiveConcurrency);
  let repCompleted = 0;

  const reputationPromises = Array.from({ length: numEpisodes }, (_, i) =>
    repLimit(async () => {
      try {
        const result = await runEpisode(
          i,
          apiKey,
          true,
          seed,
          sharedReputationSystem
        );

        // Serialize reputation update
        await reputationMutex.acquire();
        try {
          const deltas = sharedReputationSystem.inspectAndUpdate(result);
          result.reputationDeltas = deltas;
        } finally {
          reputationMutex.release();
        }

        repCompleted++;
        if (repCompleted % 10 === 0) {
          console.log(
            `Reputation: Completed ${repCompleted}/${numEpisodes} episodes`
          );
          console.log(
            `  Agent A karma: ${sharedReputationSystem.getModelReputation('model-A').karma}, ` +
              `Agent B karma: ${sharedReputationSystem.getModelReputation('model-B').karma}`
          );
        }
        return result;
      } catch (error) {
        console.error(`Reputation episode ${i} failed:`, error);
        return null;
      }
    })
  );

  const reputationSettled = await Promise.all(reputationPromises);
  const reputationResults = reputationSettled.filter(
    (r): r is EpisodeResult => r !== null
  );

  // Persist karma after all reputation episodes
  const allReps = sharedReputationSystem.getAllReputations();
  if (allReps.size > 0) {
    const karmaMap = new Map<string, number>();
    for (const [id, rep] of allReps) {
      karmaMap.set(id, rep.karma);
    }
    karmaStorage.save(karmaMap);
    console.log(`  Persisted karma for ${allReps.size} agents to ${karmaStorage.getPath()}`);
  }

  // Calculate metrics
  const baselineMetrics = calculateMetrics(baselineResults, false);
  const reputationMetrics = calculateMetrics(reputationResults, true);

  // Log results
  console.log('\n=== A/B TEST RESULTS ===');
  console.log('\nBaseline (No Reputation):');
  logMetrics(baselineMetrics);

  console.log('\nWith Reputation:');
  logMetrics(reputationMetrics);

  const { significance, warnings } = analyzeEpisodeResults(
    baselineResults,
    reputationResults,
    {
      correctionMethod: options.correctionMethod,
      manifest: options.manifest,
      seed,
    }
  );

  if (significance) {
    console.log('\n=== STATISTICAL SIGNIFICANCE ===');
    logSignificance(significance);
  }

  if (warnings.length > 0) {
    console.warn('\n=== ANALYSIS WARNINGS ===');
    warnings.forEach((warning) => console.warn(`  - ${warning}`));
  }

  const saveResults = options.saveResults ?? true;
  let runDir: string | undefined;
  if (saveResults) {
    runDir = saveRunArtifacts(
      baselineResults,
      reputationResults,
      baselineMetrics,
      reputationMetrics,
      significance,
      warnings,
      options.manifest,
      numEpisodes,
      apiKey,
      seed,
      options.resultsRoot
    );
    console.log(`\nResults saved under ${runDir}`);
  }

  return {
    baseline: baselineMetrics,
    withReputation: reputationMetrics,
    significance,
    warnings,
    manifest: options.manifest,
    runDir,
  };
}

function calculateMetrics(
  episodes: EpisodeResult[],
  reputationEnabled: boolean
): ABTestMetrics {
  const totalEpisodes = episodes.length;
  if (totalEpisodes === 0) {
    return {
      coopRate: 0,
      breachRate: 0,
      avgPayoffA: 0,
      avgPayoffB: 0,
      totalEpisodes: 0,
      reputationEnabled,
      byScenario: {},
      byModel: {},
      byRole: {},
    };
  }

  // Calculate cooperation rate (secure high/medium agreements)
  const secureAgreements = episodes.filter(
    (ep) =>
      ep.finalProtocol === ProtocolLevel.High ||
      ep.finalProtocol === ProtocolLevel.Medium
  ).length;
  const coopRate = (secureAgreements / totalEpisodes) * 100;

  // Calculate breach rate (negative payoffs)
  const breachEpisodes = episodes.filter(
    (ep) => ep.payoffs.a < 0 || ep.payoffs.b < 0
  ).length;
  const breachRate = (breachEpisodes / totalEpisodes) * 100;

  // Calculate average payoffs
  const totalPayoffA = episodes.reduce((sum, ep) => sum + ep.payoffs.a, 0);
  const totalPayoffB = episodes.reduce((sum, ep) => sum + ep.payoffs.b, 0);
  const avgPayoffA = totalPayoffA / totalEpisodes;
  const avgPayoffB = totalPayoffB / totalEpisodes;

  return {
    coopRate: Math.round(coopRate * 100) / 100,
    breachRate: Math.round(breachRate * 100) / 100,
    avgPayoffA: Math.round(avgPayoffA * 100) / 100,
    avgPayoffB: Math.round(avgPayoffB * 100) / 100,
    totalEpisodes,
    reputationEnabled,
    byScenario: buildScenarioMetrics(episodes),
    byModel: {
      [MODEL_A_ID]: buildPayoffMetrics(episodes, (episode) => episode.payoffs.a),
      [MODEL_B_ID]: buildPayoffMetrics(episodes, (episode) => episode.payoffs.b),
    },
    byRole: {
      A: buildPayoffMetrics(episodes, (episode) => episode.payoffs.a),
      B: buildPayoffMetrics(episodes, (episode) => episode.payoffs.b),
    },
  };
}

function logMetrics(metrics: ABTestMetrics): void {
  console.log(`  Cooperation Rate: ${metrics.coopRate}%`);
  console.log(`  Breach Rate: ${metrics.breachRate}%`);
  console.log(`  Avg Payoff A: ${metrics.avgPayoffA}`);
  console.log(`  Avg Payoff B: ${metrics.avgPayoffB}`);
  console.log(`  Total Episodes: ${metrics.totalEpisodes}`);
}

export function analyzeEpisodeResults(
  baselineResults: EpisodeResult[],
  reputationResults: EpisodeResult[],
  options: AnalyzeEpisodeResultsOptions = {}
): { significance: StatisticalSignificance | null; warnings: string[] } {
  const minPairs = Math.min(baselineResults.length, reputationResults.length);
  const warnings = options.manifest
    ? getManifestWarnings(options.manifest, minPairs)
    : [];

  if (minPairs < 2) {
    warnings.push('Need at least two paired episodes per condition for statistical analysis.');
    return { significance: null, warnings };
  }

  const alpha = getAnalysisAlpha(options.manifest);
  const correctionMethod =
    options.correctionMethod ??
    options.manifest?.analysisPlan.correctionMethod ??
    'none';

  const basePayoffsA = baselineResults.slice(0, minPairs).map((ep) => ep.payoffs.a);
  const repPayoffsA = reputationResults.slice(0, minPairs).map((ep) => ep.payoffs.a);
  const basePayoffsB = baselineResults.slice(0, minPairs).map((ep) => ep.payoffs.b);
  const repPayoffsB = reputationResults.slice(0, minPairs).map((ep) => ep.payoffs.b);
  const baseTotalPayoffs = baselineResults
    .slice(0, minPairs)
    .map((ep) => ep.payoffs.a + ep.payoffs.b);
  const repTotalPayoffs = reputationResults
    .slice(0, minPairs)
    .map((ep) => ep.payoffs.a + ep.payoffs.b);

  const rawPValues = [
    pairedTTest(basePayoffsA, repPayoffsA, alpha).pValue,
    pairedTTest(basePayoffsB, repPayoffsB, alpha).pValue,
    pairedTTest(baseTotalPayoffs, repTotalPayoffs, alpha).pValue,
  ];
  const correctedPValues = correctPValues(rawPValues, correctionMethod);

  if (rawPValues.length > 1 && correctionMethod === 'none') {
    warnings.push(
      'Multiple metrics were tested without correction; adjusted p-values were not applied.'
    );
  }

  const significance: StatisticalSignificance = {
    payoffA: buildMetricAnalysis(
      'payoff-a',
      basePayoffsA,
      repPayoffsA,
      alpha,
      correctedPValues[0],
      options.manifest,
      options.seed
    ),
    payoffB: buildMetricAnalysis(
      'payoff-b',
      basePayoffsB,
      repPayoffsB,
      alpha,
      correctedPValues[1],
      options.manifest,
      options.seed
    ),
    totalPayoff: buildMetricAnalysis(
      'total-payoff',
      baseTotalPayoffs,
      repTotalPayoffs,
      alpha,
      correctedPValues[2],
      options.manifest,
      options.seed
    ),
    baselineCI: buildMeanInterval(baseTotalPayoffs, options.seed),
    treatmentCI: buildMeanInterval(
      repTotalPayoffs,
      options.seed ? `${options.seed}-rep` : 'rep'
    ),
    correctionMethod,
    familyWiseErrorRate: familyWiseErrorRate(rawPValues),
    warnings,
  };

  addInterpretationWarnings(significance, warnings);

  return { significance, warnings };
}

export function loadStoredRunArtifacts(inputPath: string): StoredRunArtifacts {
  const runDir = path.resolve(inputPath);
  const baselineResults = JSON.parse(
    fs.readFileSync(path.join(runDir, 'baseline', 'episodes.json'), 'utf8')
  ) as EpisodeResult[];
  const reputationResults = JSON.parse(
    fs.readFileSync(path.join(runDir, 'reputation', 'episodes.json'), 'utf8')
  ) as EpisodeResult[];

  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath)
    ? loadExperimentManifest(manifestPath)
    : undefined;

  return {
    baselineResults,
    reputationResults,
    manifest,
  };
}

function saveRunArtifacts(
  baselineResults: EpisodeResult[],
  reputationResults: EpisodeResult[],
  baselineMetrics: ABTestMetrics,
  reputationMetrics: ABTestMetrics,
  significance: StatisticalSignificance | null,
  warnings: string[],
  manifest: ExperimentManifest | undefined,
  numEpisodes: number,
  apiKey: string | undefined,
  seed: string | undefined,
  customResultsRoot?: string
): string {
  const resultsRoot = customResultsRoot ?? path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsRoot)) {
    fs.mkdirSync(resultsRoot, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:]/g, '-')
    .replace('T', '_')
    .replace(/\..+$/, '');
  const runId = `run_${timestamp}_eps-${numEpisodes}_seed-${seed || 'default'}`;
  const runDir = path.join(resultsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const summary = {
    parameters: {
      numEpisodes,
      seed: seed || 'default',
      apiKeyProvided: Boolean(apiKey),
    },
    manifest,
    baseline: baselineMetrics,
    withReputation: reputationMetrics,
    significance,
    warnings,
  };
  fs.writeFileSync(
    path.join(runDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  if (manifest) {
    fs.writeFileSync(
      path.join(runDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
  }

  const baselineDir = path.join(runDir, 'baseline');
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, 'episodes.json'),
    JSON.stringify(baselineResults, null, 2)
  );
  baselineResults.forEach((episode) => {
    fs.writeFileSync(
      path.join(baselineDir, `episode_${episode.episodeId}.json`),
      JSON.stringify(episode, null, 2)
    );
  });

  const reputationDir = path.join(runDir, 'reputation');
  fs.mkdirSync(reputationDir, { recursive: true });
  fs.writeFileSync(
    path.join(reputationDir, 'episodes.json'),
    JSON.stringify(reputationResults, null, 2)
  );
  reputationResults.forEach((episode) => {
    fs.writeFileSync(
      path.join(reputationDir, `episode_${episode.episodeId}.json`),
      JSON.stringify(episode, null, 2)
    );
  });

  return runDir;
}

function buildScenarioMetrics(
  episodes: EpisodeResult[]
): Record<string, StratifiedMetrics> {
  const scenarios = Array.from(new Set(episodes.map((episode) => episode.trueState)));
  return Object.fromEntries(
    scenarios.map((scenario) => {
      const scenarioEpisodes = episodes.filter(
        (episode) => episode.trueState === scenario
      );
      return [
        scenario,
        buildPayoffMetrics(
          scenarioEpisodes,
          (episode) => episode.payoffs.a + episode.payoffs.b
        ),
      ];
    })
  );
}

function buildPayoffMetrics(
  episodes: EpisodeResult[],
  payoffSelector: (episode: EpisodeResult) => number
): StratifiedMetrics {
  if (episodes.length === 0) {
    return {
      totalEpisodes: 0,
      coopRate: 0,
      breachRate: 0,
      avgPayoff: 0,
      totalPayoff: 0,
    };
  }

  const totalPayoff = episodes.reduce(
    (sum, episode) => sum + payoffSelector(episode),
    0
  );
  const secureAgreements = episodes.filter(
    (episode) =>
      episode.finalProtocol === ProtocolLevel.High ||
      episode.finalProtocol === ProtocolLevel.Medium
  ).length;
  const breaches = episodes.filter(
    (episode) => episode.payoffs.a < 0 || episode.payoffs.b < 0
  ).length;

  return {
    totalEpisodes: episodes.length,
    coopRate: round((secureAgreements / episodes.length) * 100),
    breachRate: round((breaches / episodes.length) * 100),
    avgPayoff: round(totalPayoff / episodes.length),
    totalPayoff: round(totalPayoff),
  };
}

function buildMetricAnalysis(
  label: string,
  baseline: number[],
  treatment: number[],
  alpha: number,
  correctedPValue: number,
  manifest: ExperimentManifest | undefined,
  seed: string | undefined
): StatisticalSignificance['payoffA'] {
  const tTest = pairedTTest(baseline, treatment, alpha);
  const effectSize = cohensD(baseline, treatment);
  const effectSizeInterpretation = interpretEffectSize(effectSize);
  const sampleSize = Math.min(baseline.length, treatment.length);
  const requiredSampleSize =
    manifest?.sampleSize.computedMinimum ??
    computeRequiredSampleSize(
      DEFAULT_TARGET_POWER,
      alpha,
      Math.max(Math.abs(effectSize), DEFAULT_EXPECTED_EFFECT_SIZE / 10)
    );
  const diffCI = bootstrapCI(
    treatment.map((value, index) => value - baseline[index]),
    0.95,
    10000,
    seed ? `${seed}-${label}` : label
  );

  return {
    tStatistic: tTest.tStatistic,
    pValue: tTest.pValue,
    correctedPValue,
    significant: tTest.significant,
    significantAfterCorrection: correctedPValue < alpha,
    meanDifference: tTest.meanDifference,
    effectSize,
    effectSizeInterpretation,
    achievedPower: computeAchievedPower(sampleSize, alpha, effectSize),
    sampleSizeAdequate: sampleSize >= requiredSampleSize,
    ci: {
      lower: diffCI.lower,
      upper: diffCI.upper,
    },
  };
}

function buildMeanInterval(values: number[], seed: string | undefined): {
  mean: number;
  lower: number;
  upper: number;
} {
  const interval = bootstrapCI(values, 0.95, 10000, seed);
  return {
    mean: interval.mean,
    lower: interval.lower,
    upper: interval.upper,
  };
}

function addInterpretationWarnings(
  significance: StatisticalSignificance,
  warnings: string[]
): void {
  const metrics = [
    ['payoffA', significance.payoffA],
    ['payoffB', significance.payoffB],
    ['totalPayoff', significance.totalPayoff],
  ] as const;

  metrics.forEach(([label, metric]) => {
    if (metric.significantAfterCorrection && metric.effectSizeInterpretation === 'negligible') {
      warnings.push(
        `${label} is statistically significant after correction but the effect size is negligible.`
      );
    }

    if (
      !metric.significantAfterCorrection &&
      (metric.effectSizeInterpretation === 'medium' ||
        metric.effectSizeInterpretation === 'large')
    ) {
      warnings.push(
        `${label} shows a ${metric.effectSizeInterpretation} effect without corrected significance; the run may be underpowered.`
      );
    }

    if (!metric.sampleSizeAdequate) {
      warnings.push(
        `${label} was evaluated with fewer episodes than the required minimum for target power.`
      );
    }
  });
}

function getAnalysisAlpha(manifest?: ExperimentManifest): number {
  return manifest?.hypotheses[0]?.alpha ?? DEFAULT_ALPHA;
}

function logSignificance(significance: StatisticalSignificance): void {
  const metrics = [
    ['Payoff A', significance.payoffA],
    ['Payoff B', significance.payoffB],
    ['Total Payoff', significance.totalPayoff],
  ] as const;

  metrics.forEach(([label, metric]) => {
    console.log(
      `  ${label}: t=${metric.tStatistic}, p=${metric.pValue}, corrected=${metric.correctedPValue}, d=${metric.effectSize} (${metric.effectSizeInterpretation}), power=${metric.achievedPower}`
    );
  });
  console.log(
    `  Baseline total payoff CI: [${significance.baselineCI.lower}, ${significance.baselineCI.upper}] (mean=${significance.baselineCI.mean})`
  );
  console.log(
    `  Treatment total payoff CI: [${significance.treatmentCI.lower}, ${significance.treatmentCI.upper}] (mean=${significance.treatmentCI.mean})`
  );
  console.log(
    `  Correction method: ${significance.correctionMethod}, family-wise error rate=${significance.familyWiseErrorRate}`
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface SimulatorCliOptions {
  episodes?: number;
  seed: string;
  concurrency: number;
  manifestPath?: string;
}

function parseSimulatorArgs(args: string[]): SimulatorCliOptions {
  let episodes: number | undefined;
  let seed = 'default';
  let concurrency = DEFAULT_CONCURRENCY;
  let manifestPath: string | undefined;

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--episodes' && args[i + 1]) {
      episodes = parseInt(args[++i], 10);
    } else if (arg === '--seed' && args[i + 1]) {
      seed = args[++i];
    } else if (arg === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[++i], 10);
    } else if (arg === '--manifest' && args[i + 1]) {
      manifestPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printSimulatorUsage();
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  if (episodes === undefined && positional[0]) {
    episodes = parseInt(positional[0], 10);
  }
  if (seed === 'default' && positional[1]) {
    seed = positional[1];
  }
  if (concurrency === DEFAULT_CONCURRENCY && positional[2]) {
    concurrency = parseInt(positional[2], 10);
  }

  return {
    episodes,
    seed,
    concurrency,
    manifestPath,
  };
}

function printSimulatorUsage(): void {
  console.log(`
Usage: npm run simulate -- [options]

Options:
  --episodes <n>       Episodes per condition
  --seed <value>       Seed for reproducibility (default: default)
  --concurrency <n>    Episode concurrency (default: 4)
  --manifest <path>    Load an experiment manifest and preregistered analysis plan
  --help, -h           Show this help message
`);
}

// Main execution
async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const cliOptions = parseSimulatorArgs(process.argv.slice(2));
  const manifest = cliOptions.manifestPath
    ? loadExperimentManifest(cliOptions.manifestPath)
    : undefined;
  const numEpisodes =
    cliOptions.episodes ?? manifest?.sampleSize.plannedTotal ?? 100;
  const seed = cliOptions.seed;
  const concurrency = cliOptions.concurrency;

  console.log('MSPN Simulation Starting...');
  console.log(`API Key: ${apiKey ? 'Provided' : 'Using mock mode'}`);
  console.log(`Episodes: ${numEpisodes}`);
  console.log(`Seed: ${seed}`);
  console.log(`Concurrency: ${concurrency}`);
  if (manifest) {
    console.log(`Manifest: ${manifest.experimentId}`);
  }

  try {
    await runABTest(numEpisodes, apiKey, seed, concurrency, { manifest });
    console.log('\nSimulation completed successfully!');
  } catch (error) {
    console.error('Simulation failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
