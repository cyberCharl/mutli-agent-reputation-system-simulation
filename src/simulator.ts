import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import pLimit from 'p-limit';
import seedrandom from 'seedrandom';
import { MSPNGame } from './game';
import { Agent, LLMModel, Persona } from './agent';
import { ReputationSystem } from './reputation';
import { generatePersonaSeeds } from './persona';
import { SocialNetwork } from './network';
import {
  GossipDatabase,
  GossipEngine,
  ReputationDatabase,
  ReputationUpdater,
} from './reputation';
import {
  InvestmentScenario,
  MSPNNegotiationScenario,
  PrisonerDilemmaScenario,
  Scenario,
  ScenarioContext,
  ScenarioDecisionProvider,
  SignUpScenario,
} from './scenarios';
import {
  AgentRole,
  CredibilityLevel,
  EpisodeResult,
  ABTestMetrics,
  ProtocolLevel,
  ReviewAction,
  SimulationConfig,
  ScenarioResult,
  TrueState,
  StatisticalSignificance,
} from './types';
import { pairedTTest, bootstrapCI } from './stats';
import { KarmaStorage } from './karma/storage';

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
      const finalProposal = agentA.applyConsequences(proposal) as ProtocolLevel;
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
    console.log(
      `  Persisted karma for ${allReps.size} agents to ${karmaStorage.getPath()}`
    );
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
    const repCI = bootstrapCI(
      allRepPayoffs,
      0.95,
      10000,
      seed ? `${seed}-rep` : undefined
    );

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
      baselineCI: {
        mean: baseCI.mean,
        lower: baseCI.lower,
        upper: baseCI.upper,
      },
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
  });

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

export interface MultiAgentStepResult {
  step: number;
  results: ScenarioResult[];
}

export interface MultiAgentSimulatorOptions {
  apiKey?: string;
  seed?: string;
  decisionProvider?: ScenarioDecisionProvider;
  modelFactory?: (seed: string, index: number) => LLMModel;
}

function defaultSimulationConfig(): SimulationConfig {
  return {
    maxRounds: 3,
    beliefUpdateStrength: {
      proposal: 0.2,
      review: 0.15,
    },
    payoffNoise: 0,
    initialBeliefAlignment: 0.5,
    agentCount: 20,
    scenario: 'mspn',
    reputationBackend: 'repunet',
    enableGossip: true,
    gossipConfig: {
      enabled: true,
      maxSpreadDepth: 2,
      credibilityDecay: 0.3,
      recentWindow: 30,
      listenerSelection: 'random',
    },
    enableNetwork: true,
    networkConfig: {
      enabled: true,
      blackListMaxSize: 5,
      observationInterval: 5,
      initialConnectivity: 0.3,
    },
    storageConfig: {
      basePath: './sim_storage',
      runId: 'in-memory',
      persistInterval: 1,
    },
    ablationMode: 'full',
  };
}

export class MultiAgentSimulator {
  private readonly config: SimulationConfig;
  private readonly personas: Map<string, Persona> = new Map();
  private readonly network: SocialNetwork;
  private readonly reputationDb: ReputationDatabase;
  private readonly reputationUpdater: ReputationUpdater;
  private readonly gossipDb: GossipDatabase;
  private readonly gossipEngine: GossipEngine | null;
  private readonly rng: seedrandom.PRNG;
  private readonly scenario: Scenario;

  constructor(
    configOverrides: Partial<SimulationConfig> = {},
    private readonly options: MultiAgentSimulatorOptions = {}
  ) {
    this.config = {
      ...defaultSimulationConfig(),
      ...configOverrides,
      gossipConfig: {
        ...defaultSimulationConfig().gossipConfig,
        ...(configOverrides.gossipConfig ?? {}),
      },
      networkConfig: {
        ...defaultSimulationConfig().networkConfig,
        ...(configOverrides.networkConfig ?? {}),
      },
      storageConfig: {
        ...defaultSimulationConfig().storageConfig,
        ...(configOverrides.storageConfig ?? {}),
      },
      beliefUpdateStrength: {
        ...defaultSimulationConfig().beliefUpdateStrength,
        ...(configOverrides.beliefUpdateStrength ?? {}),
      },
    };

    this.rng = seedrandom(options.seed ?? 'multi-agent-default');
    this.network = new SocialNetwork(this.config.networkConfig);
    this.reputationDb = new ReputationDatabase();
    this.reputationUpdater = new ReputationUpdater(this.reputationDb);
    this.gossipDb = new GossipDatabase();
    this.gossipEngine = this.config.enableGossip
      ? new GossipEngine(
          this.config.gossipConfig,
          this.gossipDb,
          this.reputationDb
        )
      : null;
    this.scenario = this.createScenario(this.config.scenario);
  }

  async initialize(): Promise<void> {
    const seed = this.options.seed ?? 'multi-agent-default';
    const seeds = generatePersonaSeeds(
      this.config.agentCount,
      this.config.scenario
    );

    seeds.forEach((personaSeed, index) => {
      const model = this.options.modelFactory
        ? this.options.modelFactory(seed, index)
        : new LLMModel(
            this.options.apiKey,
            undefined,
            `${seed}-${personaSeed.name}`
          );
      const persona = new Persona(personaSeed, model);
      this.personas.set(persona.state.name, persona);
    });

    this.initializeNetwork();
  }

  async runStep(step: number): Promise<MultiAgentStepResult> {
    const context = this.makeContext(step);
    const pairs = await this.scenario.pair(
      Array.from(this.personas.values()),
      this.network,
      this.config,
      step
    );

    const results: ScenarioResult[] = [];
    for (const pair of pairs) {
      const result = await this.scenario.execute(pair, context);
      results.push(result);
      await this.scenario.updateReputation(pair, result, context);
      this.captureMemory(pair, result, step);

      if (this.gossipEngine && this.scenario.shouldTriggerGossip(result)) {
        await this.maybeRunGossip(pair, result, step);
      }
    }

    return { step, results };
  }

  async runSteps(stepCount: number): Promise<MultiAgentStepResult[]> {
    const total = Math.max(0, Math.floor(stepCount));
    const outputs: MultiAgentStepResult[] = [];
    for (let step = 1; step <= total; step += 1) {
      outputs.push(await this.runStep(step));
    }
    return outputs;
  }

  getConfig(): SimulationConfig {
    return { ...this.config };
  }

  getPersonaCount(): number {
    return this.personas.size;
  }

  getScenarioName(): string {
    return this.scenario.name;
  }

  getReputationDb(): ReputationDatabase {
    return this.reputationDb;
  }

  private createScenario(name: SimulationConfig['scenario']): Scenario {
    if (name === 'investment') {
      return new InvestmentScenario();
    }
    if (name === 'pd_game') {
      return new PrisonerDilemmaScenario();
    }
    if (name === 'sign_up') {
      return new SignUpScenario();
    }
    return new MSPNNegotiationScenario();
  }

  private initializeNetwork(): void {
    const personas = Array.from(this.personas.values());
    for (const source of personas) {
      for (const target of personas) {
        if (source === target) {
          continue;
        }
        if (this.rng() <= this.config.networkConfig.initialConnectivity) {
          this.network.addEdge(
            source.state.name,
            target.state.name,
            this.defaultRole(source.state.role),
            0
          );
        }
      }
    }
  }

  private makeContext(step: number): ScenarioContext {
    return {
      step,
      network: this.network,
      reputationDb: this.reputationDb,
      reputationUpdater: this.reputationUpdater,
      gossipEngine: this.gossipEngine,
      config: this.config,
      decisionProvider: this.options.decisionProvider,
      rng: this.rng,
    };
  }

  private async maybeRunGossip(
    pair: [Persona, Persona],
    result: ScenarioResult,
    step: number
  ): Promise<void> {
    if (!this.gossipEngine) {
      return;
    }
    const [source, target] = pair;
    const sourcePayoff = result.payoffs[source.state.name] ?? 0;
    if (sourcePayoff >= 0) {
      return;
    }

    const grievance = `${target.state.name} caused payoff ${sourcePayoff} for ${source.state.name}`;
    const agents = Array.from(this.personas.values());
    await this.gossipEngine.firstOrderGossip({
      gossiper: {
        id: source.getId(),
        name: source.state.name,
        role: this.defaultRole(source.state.role),
      },
      target: {
        id: target.getId(),
        name: target.state.name,
        role: this.defaultRole(target.state.role),
      },
      grievance,
      candidateListeners: agents.map((persona) => ({
        id: persona.getId(),
        name: persona.state.name,
        role: this.defaultRole(persona.state.role),
      })),
      step,
    });
  }

  private captureMemory(
    pair: [Persona, Persona],
    result: ScenarioResult,
    step: number
  ): void {
    const [a, b] = pair;
    const description = `${this.scenario.name} => ${a.state.name}:${result.payoffs[a.state.name] ?? 0}, ${b.state.name}:${result.payoffs[b.state.name] ?? 0}`;

    a.addMemory({
      type: 'event',
      subject: a.state.name,
      predicate: this.scenario.name,
      object: b.state.name,
      description,
      createdAt: step,
      metadata: { result },
    });

    b.addMemory({
      type: 'event',
      subject: b.state.name,
      predicate: this.scenario.name,
      object: a.state.name,
      description,
      createdAt: step,
      metadata: { result },
    });
  }

  private defaultRole(role: AgentRole | null): AgentRole {
    return role ?? 'player';
  }
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
