import { buildGossipEvaluationPrompt } from '../prompts';
import {
  AgentRole,
  CredibilityLevel,
  GossipConfig,
  GossipEntry,
  NumericalRecord,
  ReputationEntry,
} from '../types';
import { GossipDatabase } from './gossip-db';
import { ReputationDatabase, emptyNumericalRecord } from './reputation-db';

export interface GossipAgent {
  id: string;
  name: string;
  role: AgentRole;
}

export interface GossipEvaluationResult {
  credibilityLevel: CredibilityLevel;
  shouldSpread: boolean;
  reasoning: string;
  reputationAdjustment: number;
}

export interface FirstOrderGossipInput {
  gossiper: GossipAgent;
  target: GossipAgent;
  grievance: string;
  candidateListeners: GossipAgent[];
  step: number;
}

type Evaluator = (input: {
  listener: GossipAgent;
  gossiper: GossipAgent;
  target: GossipAgent;
  gossipInfo: string;
  sourceChain: string[];
  step: number;
  credibilityHint?: CredibilityLevel;
  depth: number;
  prompt: string;
}) => Promise<GossipEvaluationResult>;

type ReputationUpdateHook = (input: {
  listener: GossipAgent;
  target: GossipAgent;
  evaluation: GossipEvaluationResult;
  step: number;
  entry: GossipEntry;
}) => void;

export interface GossipEngineOptions {
  evaluateCredibility?: Evaluator;
  onReputationUpdate?: ReputationUpdateHook;
  rng?: () => number;
}

const CREDIBILITY_ORDER: CredibilityLevel[] = [
  'very_credible',
  'credible',
  'uncredible',
  'very_uncredible',
];

export class GossipEngine {
  private readonly evaluateCredibilityFn: Evaluator;
  private readonly onReputationUpdate?: ReputationUpdateHook;
  private readonly rng: () => number;

  constructor(
    private readonly config: GossipConfig,
    private readonly gossipDb: GossipDatabase,
    private readonly reputationDb: ReputationDatabase,
    options: GossipEngineOptions = {}
  ) {
    this.evaluateCredibilityFn =
      options.evaluateCredibility ?? this.defaultEvaluate;
    this.onReputationUpdate = options.onReputationUpdate;
    this.rng = options.rng ?? Math.random;
  }

  async firstOrderGossip(
    input: FirstOrderGossipInput
  ): Promise<GossipEntry | null> {
    if (!this.config.enabled) {
      return null;
    }

    const listener = this.selectListener(
      input.gossiper,
      input.target,
      input.candidateListeners
    );
    if (!listener) {
      return null;
    }

    const prompt = buildGossipEvaluationPrompt({
      listenerName: listener.name,
      gossiperName: input.gossiper.name,
      targetName: input.target.name,
      gossipInfo: input.grievance,
      sourceChain: [input.gossiper.name],
    });

    const evaluation = await this.evaluateCredibilityFn({
      listener,
      gossiper: input.gossiper,
      target: input.target,
      gossipInfo: input.grievance,
      sourceChain: [input.gossiper.name],
      step: input.step,
      depth: 1,
      prompt,
    });

    const firstEntry = this.createEntry({
      sourceGossiper: input.gossiper,
      target: input.target,
      gossipInfo: input.grievance,
      evaluation,
      step: input.step,
      sourceChain: [input.gossiper.name],
    });

    this.gossipDb.addEntry(firstEntry);
    this.applyReputationUpdate(
      listener,
      input.target,
      evaluation,
      input.step,
      firstEntry
    );

    if (evaluation.shouldSpread && this.config.maxSpreadDepth > 1) {
      await this.secondOrderGossip({
        spreader: listener,
        originalGossiper: input.gossiper,
        target: input.target,
        gossipInfo: input.grievance,
        sourceChain: [input.gossiper.name, listener.name],
        candidateListeners: input.candidateListeners,
        step: input.step,
        priorEvaluation: evaluation,
        depth: 2,
      });
    }

    return firstEntry;
  }

  private async secondOrderGossip(input: {
    spreader: GossipAgent;
    originalGossiper: GossipAgent;
    target: GossipAgent;
    gossipInfo: string;
    sourceChain: string[];
    candidateListeners: GossipAgent[];
    step: number;
    priorEvaluation: GossipEvaluationResult;
    depth: number;
  }): Promise<void> {
    if (input.depth > this.config.maxSpreadDepth) {
      return;
    }

    const listener = this.selectListener(
      input.spreader,
      input.target,
      input.candidateListeners,
      input.sourceChain
    );
    if (!listener) {
      return;
    }

    const credibilityHint = this.applyDecay(
      input.priorEvaluation.credibilityLevel,
      input.depth
    );

    const prompt = buildGossipEvaluationPrompt({
      listenerName: listener.name,
      gossiperName: input.spreader.name,
      targetName: input.target.name,
      gossipInfo: input.gossipInfo,
      sourceChain: input.sourceChain,
      credibilityHint,
    });

    const evaluation = await this.evaluateCredibilityFn({
      listener,
      gossiper: input.spreader,
      target: input.target,
      gossipInfo: input.gossipInfo,
      sourceChain: input.sourceChain,
      step: input.step,
      depth: input.depth,
      credibilityHint,
      prompt,
    });

    const entry = this.createEntry({
      sourceGossiper: input.spreader,
      target: input.target,
      gossipInfo: input.gossipInfo,
      evaluation,
      step: input.step,
      sourceChain: input.sourceChain,
    });

    this.gossipDb.addEntry(entry);
    this.applyReputationUpdate(
      listener,
      input.target,
      evaluation,
      input.step,
      entry
    );

    if (evaluation.shouldSpread) {
      await this.secondOrderGossip({
        ...input,
        spreader: listener,
        sourceChain: [...input.sourceChain, listener.name],
        priorEvaluation: evaluation,
        depth: input.depth + 1,
      });
    }
  }

  private createEntry(input: {
    sourceGossiper: GossipAgent;
    target: GossipAgent;
    gossipInfo: string;
    evaluation: GossipEvaluationResult;
    step: number;
    sourceChain: string[];
  }): GossipEntry {
    return {
      complainedName: input.target.name,
      complainedId: Number(input.target.id),
      complainedRole: input.target.role,
      gossiperName: input.sourceGossiper.name,
      gossiperRole: input.sourceGossiper.role,
      gossipInfo: input.gossipInfo,
      credibilityLevel: input.evaluation.credibilityLevel,
      shouldSpread: input.evaluation.shouldSpread,
      reasons: input.evaluation.reasoning,
      createdAtStep: input.step,
      sourceChain: [...input.sourceChain],
    };
  }

  private selectListener(
    gossiper: GossipAgent,
    target: GossipAgent,
    candidates: GossipAgent[],
    sourceChain: string[] = []
  ): GossipAgent | null {
    const disallowed = new Set<string>([
      gossiper.id,
      target.id,
      ...sourceChain.map((name) => {
        const match = candidates.find((candidate) => candidate.name === name);
        return match?.id ?? '';
      }),
    ]);
    const pool = candidates.filter(
      (candidate) => !disallowed.has(candidate.id)
    );

    if (pool.length === 0) {
      return null;
    }

    if (this.config.listenerSelection === 'reputation_weighted') {
      const weights = pool.map((candidate) => {
        const score = this.reputationDb.getAggregateScore(
          gossiper.id,
          candidate.id
        );
        return Math.max(0.01, score + 1.1);
      });

      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      if (totalWeight > 0) {
        let roll = this.rng() * totalWeight;
        for (let i = 0; i < pool.length; i += 1) {
          roll -= weights[i];
          if (roll <= 0) {
            return pool[i];
          }
        }
      }
    }

    const index = Math.floor(this.rng() * pool.length);
    return pool[index];
  }

  private applyDecay(level: CredibilityLevel, depth: number): CredibilityLevel {
    const baseScore = this.credibilityToScore(level);
    const decayFactor = Math.max(
      0,
      1 - this.config.credibilityDecay * (depth - 1)
    );
    const decayedScore = baseScore * decayFactor;
    return this.scoreToCredibility(decayedScore);
  }

  private applyReputationUpdate(
    listener: GossipAgent,
    target: GossipAgent,
    evaluation: GossipEvaluationResult,
    step: number,
    entry: GossipEntry
  ): void {
    if (evaluation.reputationAdjustment === 0) {
      return;
    }

    const current = this.reputationDb.getReputation(
      listener.id,
      target.id,
      target.role
    );
    const previousRecord = current?.numericalRecord ?? emptyNumericalRecord();
    const nextRecord = this.adjustRecord(
      previousRecord,
      evaluation.reputationAdjustment
    );

    const updated: ReputationEntry = {
      name: target.name,
      id: Number(target.id),
      role: target.role,
      content:
        current?.content ??
        `Reputation formed from gossip reports regarding ${target.name}.`,
      numericalRecord: nextRecord,
      reason: `Gossip update: ${evaluation.reasoning}`,
      updatedAtStep: step,
    };

    this.reputationDb.updateReputation(listener.id, updated);

    if (this.onReputationUpdate) {
      this.onReputationUpdate({
        listener,
        target,
        evaluation,
        step,
        entry,
      });
    }
  }

  private adjustRecord(
    record: NumericalRecord,
    adjustment: number
  ): NumericalRecord {
    if (adjustment >= 0) {
      return {
        ...record,
        returnSuccesses: record.returnSuccesses + adjustment,
      };
    }

    const magnitude = Math.abs(adjustment);
    return {
      ...record,
      returnIssues: record.returnIssues + magnitude,
    };
  }

  private readonly defaultEvaluate: Evaluator = async ({
    credibilityHint,
    depth,
  }) => {
    const level = credibilityHint ?? (depth === 1 ? 'credible' : 'uncredible');
    const shouldSpread =
      CREDIBILITY_ORDER.indexOf(level) <= 1 &&
      depth < this.config.maxSpreadDepth;
    return {
      credibilityLevel: level,
      shouldSpread,
      reasoning:
        'Heuristic credibility evaluation (no external evaluator provided).',
      reputationAdjustment: this.credibilityToScore(level),
    };
  };

  private credibilityToScore(level: CredibilityLevel): number {
    if (level === 'very_credible') {
      return 1;
    }
    if (level === 'credible') {
      return 0.5;
    }
    if (level === 'uncredible') {
      return -0.5;
    }
    return -1;
  }

  private scoreToCredibility(score: number): CredibilityLevel {
    if (score >= 0.75) {
      return 'very_credible';
    }
    if (score >= 0) {
      return 'credible';
    }
    if (score >= -0.75) {
      return 'uncredible';
    }
    return 'very_uncredible';
  }
}
