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
  NestedBelief,
} from './types';
import { pairedTTest, bootstrapCI } from './stats';
import { KarmaStorage } from './karma/storage';
import { CausalDecisionLog, CausalDecisionRecord } from './causal';

const DEFAULT_CONCURRENCY = 4;

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

function computeExpectedPayoff(
  protocol: ProtocolLevel | undefined,
  beliefs: NestedBelief
): number {
  if (!protocol) return 2; // rejection payoff
  if (
    protocol === ProtocolLevel.High ||
    protocol === ProtocolLevel.Medium
  ) {
    return 10; // secure coordination, no state dependence
  }
  // Low protocol: depends on true state belief
  const safeProb = beliefs.own[TrueState.SafeLow] || 0.5;
  // Expected: safeProb * avg(12,8) + (1-safeProb) * (-5)
  return safeProb * 10 + (1 - safeProb) * -5;
}

export async function runEpisode(
  episodeId: number,
  apiKey?: string,
  useReputation: boolean = false,
  seed?: string,
  reputationSystem: ReputationSystem | null = null
): Promise<EpisodeResult> {
  const episodeSeed = seed ? `${seed}-${episodeId}` : undefined;
  const game = new MSPNGame(episodeSeed);
  const causalLog = new CausalDecisionLog(episodeSeed || `default-${episodeId}`);

  // Create agents with seeded RNG for reproducible mock behavior
  const modelA = new LLMModel(
    apiKey,
    'google/gemini-2.5-flash-lite',
    episodeSeed ? `${episodeSeed}-A` : undefined
  );
  const modelB = new LLMModel(
    apiKey,
    'mistralai/mistral-small-3.1-24b-instruct',
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
  const allDecisionIds: string[] = [];

  try {
    let roundCount = 0;
    let converged = false;

    for (let round = 0; round < maxRounds; round++) {
      roundCount = round + 1;

      // Phase 1: Proposal
      const state = game.getState();
      const karmaA = agentA.getReputation().karma;
      const opponentKarmaForA =
        useReputation && reputationSystem
          ? reputationSystem.getModelReputation('model-B').karma
          : undefined;

      // Snapshot pre-decision state for proposer
      const proposerDecisionId = causalLog.generateDecisionId();
      const proposerInfoSet = {
        ownKarma: karmaA,
        opponentKarma: opponentKarmaForA ?? 50,
        beliefs: JSON.parse(JSON.stringify(state.agentBeliefs.a)) as NestedBelief,
        historyVisible: [...state.history],
      };

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
      const proposalWasForced = finalProposal !== proposal;
      game.setProposal(finalProposal);

      // Record proposer decision
      const proposerMetadata = agentA.getLastDecisionMetadata();
      const proposerRecord: CausalDecisionRecord = {
        traceId: causalLog.traceId,
        decisionId: proposerDecisionId,
        informationSet: proposerInfoSet,
        action: {
          type: 'propose',
          value: finalProposal,
          reasoning: proposerMetadata?.reasoning ?? 'mock',
          alternatives: ['low', 'medium', 'high'],
          isForced: proposalWasForced,
        },
      };
      causalLog.addRecord(proposerRecord);
      allDecisionIds.push(proposerDecisionId);

      // Phase 2: Review
      const reviewState = game.getState();
      const karmaB = agentB.getReputation().karma;
      const opponentKarmaForB =
        useReputation && reputationSystem
          ? reputationSystem.getModelReputation('model-A').karma
          : undefined;

      // Snapshot pre-decision state for reviewer
      const reviewerDecisionId = causalLog.generateDecisionId();
      const reviewerInfoSet = {
        ownKarma: karmaB,
        opponentKarma: opponentKarmaForB ?? 50,
        beliefs: JSON.parse(JSON.stringify(reviewState.agentBeliefs.b)) as NestedBelief,
        historyVisible: [...reviewState.history],
      };

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
      const reviewWasForced = finalReviewAction !== reviewAction;
      game.setReview(finalReviewAction);

      // Record reviewer decision
      const reviewerMetadata = agentB.getLastDecisionMetadata();
      const reviewerRecord: CausalDecisionRecord = {
        traceId: causalLog.traceId,
        decisionId: reviewerDecisionId,
        parentDecisionId: proposerDecisionId,
        informationSet: reviewerInfoSet,
        action: {
          type: 'review',
          value: finalReviewAction,
          reasoning: reviewerMetadata?.reasoning ?? 'mock',
          alternatives: ['accept', 'reject', 'modify-low', 'modify-medium', 'modify-high'],
          isForced: reviewWasForced,
        },
      };
      causalLog.addRecord(reviewerRecord);
      allDecisionIds.push(reviewerDecisionId);

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

    // Back-fill outcome data on all causal records
    for (const record of causalLog.getRecords()) {
      const isProposer = record.action.type === 'propose';
      const agentPayoff = isProposer ? finalPayoffs.a : finalPayoffs.b;
      const counterpartyAction = isProposer
        ? (finalState.reviewAction ?? 'none')
        : (finalState.proposal ?? 'none');
      const expectedPayoff = computeExpectedPayoff(
        finalState.finalProtocol,
        record.informationSet.beliefs
      );

      causalLog.backfillOutcome(record.decisionId, {
        counterpartyAction: String(counterpartyAction),
        finalProtocol: finalState.finalProtocol,
        payoff: agentPayoff,
        expectedPayoff: Math.round(expectedPayoff * 100) / 100,
        surprise: Math.round(Math.abs(agentPayoff - expectedPayoff) * 100) / 100,
      });

      // Back-fill belief update
      const karmaDelta = isProposer
        ? 0 // Will be computed by reputation system later if applicable
        : 0;
      const postBeliefs = isProposer
        ? finalState.agentBeliefs.a
        : finalState.agentBeliefs.b;
      const preBeliefs = record.informationSet.beliefs;
      const safeDelta =
        postBeliefs.own[TrueState.SafeLow] -
        preBeliefs.own[TrueState.SafeLow];
      const oppSafeDelta =
        postBeliefs.aboutOpponent[TrueState.SafeLow] -
        preBeliefs.aboutOpponent[TrueState.SafeLow];
      const updateMagnitude = Math.sqrt(
        safeDelta * safeDelta + oppSafeDelta * oppSafeDelta
      );

      causalLog.backfillBeliefUpdate(record.decisionId, {
        karmaDelta,
        beliefDelta: {
          own: {
            [TrueState.SafeLow]: Math.round(safeDelta * 10000) / 10000,
            [TrueState.DangerousLow]: Math.round(-safeDelta * 10000) / 10000,
          },
          aboutOpponent: {
            [TrueState.SafeLow]: Math.round(oppSafeDelta * 10000) / 10000,
            [TrueState.DangerousLow]: Math.round(-oppSafeDelta * 10000) / 10000,
          },
        },
        updateMagnitude: Math.round(updateMagnitude * 10000) / 10000,
      });
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
      decisionLog: causalLog,
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
  concurrency: number = DEFAULT_CONCURRENCY
): Promise<{ baseline: ABTestMetrics; withReputation: ABTestMetrics }> {
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

          // Back-fill karmaDelta on causal records
          if (result.decisionLog) {
            for (const record of result.decisionLog.getRecords()) {
              if (record.beliefUpdate) {
                const isProposer = record.action.type === 'propose';
                record.beliefUpdate.karmaDelta = isProposer
                  ? deltas.a
                  : deltas.b;
              }
            }
          }
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

  // Statistical significance analysis
  let significance: StatisticalSignificance | null = null;
  const minPairs = Math.min(baselineResults.length, reputationResults.length);
  if (minPairs >= 2) {
    const basePayoffsA = baselineResults
      .slice(0, minPairs)
      .map((ep) => ep.payoffs.a);
    const repPayoffsA = reputationResults
      .slice(0, minPairs)
      .map((ep) => ep.payoffs.a);
    const basePayoffsB = baselineResults
      .slice(0, minPairs)
      .map((ep) => ep.payoffs.b);
    const repPayoffsB = reputationResults
      .slice(0, minPairs)
      .map((ep) => ep.payoffs.b);

    const tTestA = pairedTTest(basePayoffsA, repPayoffsA);
    const tTestB = pairedTTest(basePayoffsB, repPayoffsB);

    const allBasePayoffs = baselineResults.map(
      (ep) => ep.payoffs.a + ep.payoffs.b
    );
    const allRepPayoffs = reputationResults.map(
      (ep) => ep.payoffs.a + ep.payoffs.b
    );

    const baseCI = bootstrapCI(allBasePayoffs, 0.95, 10000, seed);
    const repCI = bootstrapCI(allRepPayoffs, 0.95, 10000, seed ? `${seed}-rep` : undefined);

    significance = {
      payoffA: {
        tStatistic: tTestA.tStatistic,
        pValue: tTestA.pValue,
        significant: tTestA.significant,
        meanDifference: tTestA.meanDifference,
      },
      payoffB: {
        tStatistic: tTestB.tStatistic,
        pValue: tTestB.pValue,
        significant: tTestB.significant,
        meanDifference: tTestB.meanDifference,
      },
      baselineCI: { mean: baseCI.mean, lower: baseCI.lower, upper: baseCI.upper },
      treatmentCI: { mean: repCI.mean, lower: repCI.lower, upper: repCI.upper },
    };

    console.log('\n=== STATISTICAL SIGNIFICANCE ===');
    console.log(
      `  Payoff A: t=${tTestA.tStatistic}, p=${tTestA.pValue} ${tTestA.significant ? '(SIGNIFICANT)' : '(not significant)'}`
    );
    console.log(
      `  Payoff B: t=${tTestB.tStatistic}, p=${tTestB.pValue} ${tTestB.significant ? '(SIGNIFICANT)' : '(not significant)'}`
    );
    console.log(
      `  Baseline total payoff CI: [${baseCI.lower}, ${baseCI.upper}] (mean=${baseCI.mean})`
    );
    console.log(
      `  Treatment total payoff CI: [${repCI.lower}, ${repCI.upper}] (mean=${repCI.mean})`
    );
  }

  // Save results in layered directory structure
  const resultsRoot = path.join(process.cwd(), 'results');
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

  // Write a concise summary at the run root
  const summary = {
    parameters: {
      numEpisodes,
      seed: seed || 'default',
      apiKeyProvided: Boolean(apiKey),
    },
    baseline: baselineMetrics,
    withReputation: reputationMetrics,
    significance,
  };
  fs.writeFileSync(
    path.join(runDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  // Baseline variant folder
  const baselineDir = path.join(runDir, 'baseline');
  fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(
    path.join(baselineDir, 'episodes.json'),
    JSON.stringify(baselineResults, null, 2)
  );
  baselineResults.forEach((ep) => {
    const file = path.join(baselineDir, `episode_${ep.episodeId}.json`);
    fs.writeFileSync(file, JSON.stringify(ep, null, 2));
    // Save causal decision log as NDJSON
    if (ep.decisionLog) {
      ep.decisionLog.saveToFile(
        path.join(baselineDir, `episode_${ep.episodeId}_decisions.ndjson`)
      );
    }
  });

  // Reputation variant folder
  const reputationDir = path.join(runDir, 'reputation');
  fs.mkdirSync(reputationDir, { recursive: true });
  fs.writeFileSync(
    path.join(reputationDir, 'episodes.json'),
    JSON.stringify(reputationResults, null, 2)
  );
  reputationResults.forEach((ep) => {
    const file = path.join(reputationDir, `episode_${ep.episodeId}.json`);
    fs.writeFileSync(file, JSON.stringify(ep, null, 2));
    // Save causal decision log as NDJSON
    if (ep.decisionLog) {
      ep.decisionLog.saveToFile(
        path.join(reputationDir, `episode_${ep.episodeId}_decisions.ndjson`)
      );
    }
  });

  // Aggregated decisions directory
  const decisionsDir = path.join(runDir, 'decisions');
  fs.mkdirSync(decisionsDir, { recursive: true });
  const allDecisionsFile = path.join(decisionsDir, 'all_decisions.ndjson');
  for (const ep of [...baselineResults, ...reputationResults]) {
    if (ep.decisionLog) {
      ep.decisionLog.appendToFile(allDecisionsFile);
    }
  }

  console.log(`\nResults saved under ${runDir}`);

  return { baseline: baselineMetrics, withReputation: reputationMetrics };
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
  };
}

function logMetrics(metrics: ABTestMetrics): void {
  console.log(`  Cooperation Rate: ${metrics.coopRate}%`);
  console.log(`  Breach Rate: ${metrics.breachRate}%`);
  console.log(`  Avg Payoff A: ${metrics.avgPayoffA}`);
  console.log(`  Avg Payoff B: ${metrics.avgPayoffB}`);
  console.log(`  Total Episodes: ${metrics.totalEpisodes}`);
}

// Main execution
async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const numEpisodes = parseInt(process.argv[2]) || 100;
  const seed = process.argv[3] || 'default';
  const concurrency = parseInt(process.argv[4]) || DEFAULT_CONCURRENCY;

  console.log('MSPN Simulation Starting...');
  console.log(`API Key: ${apiKey ? 'Provided' : 'Using mock mode'}`);
  console.log(`Episodes: ${numEpisodes}`);
  console.log(`Seed: ${seed}`);
  console.log(`Concurrency: ${concurrency}`);

  try {
    await runABTest(numEpisodes, apiKey, seed, concurrency);
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
