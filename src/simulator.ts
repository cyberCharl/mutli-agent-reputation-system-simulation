import * as fs from 'fs';
import * as path from 'path';
import { MSPNGame } from './game';
import { Agent, LLMModel } from './agent';
import { ReputationSystem } from './reputation';
import {
  EpisodeResult,
  ABTestMetrics,
  ProtocolLevel,
  ReviewAction,
  TrueState,
} from './types';

export async function runEpisode(
  episodeId: number,
  apiKey?: string,
  useReputation: boolean = false,
  seed?: string
): Promise<EpisodeResult> {
  const game = new MSPNGame(seed ? `${seed}-${episodeId}` : undefined);
  const reputationSystem = useReputation ? new ReputationSystem() : null;

  // Create agents
  const modelA = new LLMModel(apiKey);
  const modelB = new LLMModel(apiKey);
  const agentA = new Agent('A', modelA);
  const agentB = new Agent('B', modelB);

  // Apply reputation consequences if enabled
  if (useReputation && reputationSystem) {
    const repA = reputationSystem.getModelReputation('model-A');
    const repB = reputationSystem.getModelReputation('model-B');
    agentA.setReputation(repA.karma);
    agentB.setReputation(repB.karma);
  }

  try {
    // Phase 1: Proposal
    const state = game.getState();
    const proposal = await agentA.act(
      'propose',
      state.agentBeliefs.a,
      state.history
    );

    // Apply reputation consequences
    const finalProposal = agentA.applyConsequences(proposal) as ProtocolLevel;
    game.setProposal(finalProposal);

    // Phase 2: Review
    const reviewState = game.getState();
    const reviewAction = await agentB.act(
      'review',
      reviewState.agentBeliefs.b,
      reviewState.history,
      reviewState.proposal
    );

    // Apply reputation consequences
    const finalReviewAction = agentB.applyConsequences(
      reviewAction
    ) as ReviewAction;
    game.setReview(finalReviewAction);

    // Phase 3: Execution
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
    };

    // Update reputation if enabled
    if (useReputation && reputationSystem) {
      const deltas = reputationSystem.inspectAndUpdate(result);
      result.reputationDeltas = deltas;
    }

    return result;
  } catch (error) {
    console.error(`Episode ${episodeId} failed:`, error);
    throw error;
  }
}

export async function runABTest(
  numEpisodes: number = 100,
  apiKey?: string,
  seed?: string
): Promise<{ baseline: ABTestMetrics; withReputation: ABTestMetrics }> {
  console.log(`Starting A/B test with ${numEpisodes} episodes each...`);

  // Run baseline (no reputation)
  console.log('Running baseline (no reputation)...');
  const baselineResults: EpisodeResult[] = [];

  for (let i = 0; i < numEpisodes; i++) {
    try {
      const result = await runEpisode(i, apiKey, false, seed);
      baselineResults.push(result);

      if ((i + 1) % 10 === 0) {
        console.log(`Baseline: Completed ${i + 1}/${numEpisodes} episodes`);
      }
    } catch (error) {
      console.error(`Baseline episode ${i} failed:`, error);
    }
  }

  // Run with reputation
  console.log('Running with reputation system...');
  const reputationResults: EpisodeResult[] = [];

  for (let i = 0; i < numEpisodes; i++) {
    try {
      const result = await runEpisode(i, apiKey, true, seed);
      reputationResults.push(result);

      if ((i + 1) % 10 === 0) {
        console.log(`Reputation: Completed ${i + 1}/${numEpisodes} episodes`);
      }
    } catch (error) {
      console.error(`Reputation episode ${i} failed:`, error);
    }
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

// Main execution
async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const numEpisodes = parseInt(process.argv[2]) || 100;
  const seed = process.argv[3] || 'default';

  console.log('MSPN Simulation Starting...');
  console.log(`API Key: ${apiKey ? 'Provided' : 'Using mock mode'}`);
  console.log(`Episodes: ${numEpisodes}`);
  console.log(`Seed: ${seed}`);

  try {
    await runABTest(numEpisodes, apiKey, seed);
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
