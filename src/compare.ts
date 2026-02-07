import * as fs from 'fs';
import * as path from 'path';
import seedrandom from 'seedrandom';
import {
  OpenRouterClient,
  StructuredResponse,
  SUPPORTED_MODELS,
  SupportedModel,
} from './openrouter';
import {
  ProposalResponseSchema,
  ReviewResponseSchema,
  ProposalResponseJsonSchema,
  ReviewResponseJsonSchema,
  ProposalResponse,
  ReviewResponse,
} from './schemas';
import { formatProposalPrompt, formatReviewPrompt } from './prompts';
import { MSPNGame } from './game';
import { ProtocolLevel, ReviewAction, TrueState, NestedBelief } from './types';

export interface ComparisonConfig {
  models: string[];
  episodesPerModel: number;
  seed: number;
  apiKey: string;
  rateLimit?: number;
}

export interface ModelStats {
  avgCooperationRate: number;
  avgPayoff: number;
  avgKarmaDelta: number;
  collapseRate: number;
  costTotal: number;
  latencyAvgMs: number;
  episodes: number;
}

export interface MatchupStats {
  proposerModel: string;
  reviewerModel: string;
  cooperationRate: number;
  avgPayoffProposer: number;
  avgPayoffReviewer: number;
  episodes: number;
}

export interface ComparisonResults {
  config: {
    models: string[];
    episodesPerModel: number;
    seed: number;
    timestamp: string;
  };
  byModel: Record<string, ModelStats>;
  headToHead: Record<string, MatchupStats>;
  totalCost: number;
  totalRequests: number;
}

interface EpisodeOutcome {
  proposerModel: string;
  reviewerModel: string;
  finalProtocol?: ProtocolLevel;
  payoffs: { a: number; b: number };
  cooperated: boolean;
  collapsed: boolean;
  costProposer: number;
  costReviewer: number;
  latencyProposer: number;
  latencyReviewer: number;
  roundCount: number;
}

function mapProposalToProtocol(proposal: string): ProtocolLevel {
  const map: Record<string, ProtocolLevel> = {
    Low: ProtocolLevel.Low,
    Medium: ProtocolLevel.Medium,
    High: ProtocolLevel.High,
  };
  return map[proposal] || ProtocolLevel.Medium;
}

function mapDecisionToReviewAction(
  decision: string,
  counterProposal?: string | null
): ReviewAction {
  if (decision === 'Accept') return ReviewAction.Accept;
  if (decision === 'Reject') return ReviewAction.Reject;
  // Modify — use counter_proposal or default to ModifyMedium
  if (counterProposal === 'Low') return ReviewAction.ModifyLow;
  if (counterProposal === 'High') return ReviewAction.ModifyHigh;
  return ReviewAction.ModifyMedium;
}

async function runMatchupEpisode(
  proposerClient: OpenRouterClient,
  reviewerClient: OpenRouterClient,
  episodeSeed: string
): Promise<EpisodeOutcome> {
  const game = new MSPNGame(episodeSeed);
  const maxRounds = 3;
  let roundCount = 0;
  let totalCostProposer = 0;
  let totalCostReviewer = 0;
  let totalLatencyProposer = 0;
  let totalLatencyReviewer = 0;

  for (let round = 0; round < maxRounds; round++) {
    roundCount = round + 1;
    const state = game.getState();

    // Proposer turn
    const proposalPrompt = formatProposalPrompt(
      state.agentBeliefs.a,
      state.history
    );
    const proposalResponse: StructuredResponse<ProposalResponse> =
      await proposerClient.complete(
        proposalPrompt,
        ProposalResponseJsonSchema,
        ProposalResponseSchema,
        { temperature: 0.7 }
      );
    totalCostProposer += proposalResponse.cost;
    totalLatencyProposer += proposalResponse.latencyMs;

    const protocolLevel = mapProposalToProtocol(
      proposalResponse.data.proposal
    );
    game.setProposal(protocolLevel);

    // Reviewer turn
    const reviewState = game.getState();
    const reviewPrompt = formatReviewPrompt(
      protocolLevel,
      reviewState.agentBeliefs.b,
      reviewState.history
    );
    const reviewResponse: StructuredResponse<ReviewResponse> =
      await reviewerClient.complete(
        reviewPrompt,
        ReviewResponseJsonSchema,
        ReviewResponseSchema,
        { temperature: 0.7 }
      );
    totalCostReviewer += reviewResponse.cost;
    totalLatencyReviewer += reviewResponse.latencyMs;

    const reviewAction = mapDecisionToReviewAction(
      reviewResponse.data.decision,
      reviewResponse.data.counter_proposal
    );
    game.setReview(reviewAction);

    if (game.isAgreement() || round === maxRounds - 1) {
      break;
    }
    game.resetForNewRound();
  }

  const finalState = game.resolveExecution();
  const payoffs = finalState.payoffs!;
  const cooperated =
    finalState.finalProtocol === ProtocolLevel.High ||
    finalState.finalProtocol === ProtocolLevel.Medium;
  const collapsed = payoffs.a < 0 && payoffs.b < 0;

  return {
    proposerModel: proposerClient.getModel(),
    reviewerModel: reviewerClient.getModel(),
    finalProtocol: finalState.finalProtocol,
    payoffs,
    cooperated,
    collapsed,
    costProposer: totalCostProposer,
    costReviewer: totalCostReviewer,
    latencyProposer: totalLatencyProposer,
    latencyReviewer: totalLatencyReviewer,
    roundCount,
  };
}

export async function runComparison(
  config: ComparisonConfig
): Promise<ComparisonResults> {
  const { models, episodesPerModel, seed, apiKey, rateLimit } = config;
  const outcomes: EpisodeOutcome[] = [];

  console.log(
    `\nStarting comparison: ${models.length} models, ${episodesPerModel} episodes each`
  );
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Seed: ${seed}\n`);

  // Create clients for each model
  const clients = new Map<string, OpenRouterClient>();
  for (const model of models) {
    clients.set(
      model,
      new OpenRouterClient({ apiKey, model, rateLimit: rateLimit ?? 200 })
    );
  }

  // Run all pairwise matchups (including self-play)
  for (const proposerModel of models) {
    for (const reviewerModel of models) {
      const matchupKey = `${proposerModel} vs ${reviewerModel}`;
      console.log(`  Running matchup: ${matchupKey}`);

      const proposerClient = clients.get(proposerModel)!;
      const reviewerClient = clients.get(reviewerModel)!;

      for (let ep = 0; ep < episodesPerModel; ep++) {
        const episodeSeed = `${seed}-${proposerModel}-${reviewerModel}-${ep}`;
        try {
          const outcome = await runMatchupEpisode(
            proposerClient,
            reviewerClient,
            episodeSeed
          );
          outcomes.push(outcome);

          if ((ep + 1) % 5 === 0) {
            console.log(`    Completed ${ep + 1}/${episodesPerModel} episodes`);
          }
        } catch (error) {
          console.error(
            `    Episode ${ep} failed for ${matchupKey}:`,
            error instanceof Error ? error.message : error
          );
        }
      }
    }
  }

  // Aggregate results
  const byModel: Record<string, ModelStats> = {};
  const headToHead: Record<string, MatchupStats> = {};

  for (const model of models) {
    const asProposer = outcomes.filter((o) => o.proposerModel === model);
    const asReviewer = outcomes.filter((o) => o.reviewerModel === model);
    const allInvolved = outcomes.filter(
      (o) => o.proposerModel === model || o.reviewerModel === model
    );

    if (allInvolved.length === 0) {
      byModel[model] = {
        avgCooperationRate: 0,
        avgPayoff: 0,
        avgKarmaDelta: 0,
        collapseRate: 0,
        costTotal: 0,
        latencyAvgMs: 0,
        episodes: 0,
      };
      continue;
    }

    const coopCount = allInvolved.filter((o) => o.cooperated).length;
    const collapseCount = allInvolved.filter((o) => o.collapsed).length;
    const totalPayoff =
      asProposer.reduce((sum, o) => sum + o.payoffs.a, 0) +
      asReviewer.reduce((sum, o) => sum + o.payoffs.b, 0);
    const totalCost =
      asProposer.reduce((sum, o) => sum + o.costProposer, 0) +
      asReviewer.reduce((sum, o) => sum + o.costReviewer, 0);
    const totalLatency =
      asProposer.reduce((sum, o) => sum + o.latencyProposer, 0) +
      asReviewer.reduce((sum, o) => sum + o.latencyReviewer, 0);
    const totalRequests = asProposer.length + asReviewer.length;

    byModel[model] = {
      avgCooperationRate: coopCount / allInvolved.length,
      avgPayoff: totalPayoff / (asProposer.length + asReviewer.length),
      avgKarmaDelta: 0, // Would need reputation system integration
      collapseRate: collapseCount / allInvolved.length,
      costTotal: totalCost,
      latencyAvgMs: totalRequests > 0 ? totalLatency / totalRequests : 0,
      episodes: allInvolved.length,
    };
  }

  // Head-to-head stats
  for (const proposerModel of models) {
    for (const reviewerModel of models) {
      const matchupOutcomes = outcomes.filter(
        (o) =>
          o.proposerModel === proposerModel &&
          o.reviewerModel === reviewerModel
      );

      if (matchupOutcomes.length === 0) continue;

      const key = `${proposerModel} vs ${reviewerModel}`;
      const coopCount = matchupOutcomes.filter((o) => o.cooperated).length;

      headToHead[key] = {
        proposerModel,
        reviewerModel,
        cooperationRate: coopCount / matchupOutcomes.length,
        avgPayoffProposer:
          matchupOutcomes.reduce((s, o) => s + o.payoffs.a, 0) /
          matchupOutcomes.length,
        avgPayoffReviewer:
          matchupOutcomes.reduce((s, o) => s + o.payoffs.b, 0) /
          matchupOutcomes.length,
        episodes: matchupOutcomes.length,
      };
    }
  }

  const totalCost = outcomes.reduce(
    (s, o) => s + o.costProposer + o.costReviewer,
    0
  );
  const totalRequests = Array.from(clients.values()).reduce(
    (s, c) => s + c.getRequestCount(),
    0
  );

  const results: ComparisonResults = {
    config: {
      models,
      episodesPerModel,
      seed,
      timestamp: new Date().toISOString(),
    },
    byModel,
    headToHead,
    totalCost,
    totalRequests,
  };

  return results;
}

export function printComparisonSummary(results: ComparisonResults): void {
  console.log('\n' + '='.repeat(70));
  console.log('  MULTI-MODEL COMPARISON RESULTS');
  console.log('='.repeat(70));

  console.log(`\nModels: ${results.config.models.length}`);
  console.log(`Episodes per matchup: ${results.config.episodesPerModel}`);
  console.log(`Seed: ${results.config.seed}`);
  console.log(`Total cost: $${results.totalCost.toFixed(4)}`);
  console.log(`Total requests: ${results.totalRequests}`);

  console.log('\n--- Per-Model Aggregates ---\n');
  for (const [model, stats] of Object.entries(results.byModel)) {
    const shortName = model.split('/').pop() || model;
    console.log(`  ${shortName}:`);
    console.log(
      `    Cooperation rate: ${(stats.avgCooperationRate * 100).toFixed(1)}%`
    );
    console.log(`    Avg payoff: ${stats.avgPayoff.toFixed(2)}`);
    console.log(
      `    Collapse rate: ${(stats.collapseRate * 100).toFixed(1)}%`
    );
    console.log(`    Cost: $${stats.costTotal.toFixed(4)}`);
    console.log(`    Avg latency: ${stats.latencyAvgMs.toFixed(0)}ms`);
    console.log(`    Episodes: ${stats.episodes}`);
  }

  console.log('\n--- Head-to-Head Matchups ---\n');
  for (const [key, stats] of Object.entries(results.headToHead)) {
    console.log(`  ${key}:`);
    console.log(
      `    Coop: ${(stats.cooperationRate * 100).toFixed(1)}% | ` +
        `Proposer payoff: ${stats.avgPayoffProposer.toFixed(2)} | ` +
        `Reviewer payoff: ${stats.avgPayoffReviewer.toFixed(2)} | ` +
        `Episodes: ${stats.episodes}`
    );
  }

  console.log('\n' + '='.repeat(70));
}

export function saveComparisonResults(
  results: ComparisonResults,
  outputDir?: string
): string {
  const resultsRoot = outputDir || path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsRoot)) {
    fs.mkdirSync(resultsRoot, { recursive: true });
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:]/g, '-')
    .replace('T', '_')
    .replace(/\..+$/, '');
  const runId = `compare_${timestamp}_seed-${results.config.seed}`;
  const runDir = path.join(resultsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(
    path.join(runDir, 'comparison.json'),
    JSON.stringify(results, null, 2)
  );

  // Create a symlink for "latest"
  const latestLink = path.join(resultsRoot, 'latest');
  try {
    if (fs.existsSync(latestLink)) {
      fs.unlinkSync(latestLink);
    }
    fs.symlinkSync(runDir, latestLink);
  } catch {
    // Symlink might fail on some systems, non-critical
  }

  console.log(`\nResults saved to ${runDir}/comparison.json`);
  return runDir;
}
