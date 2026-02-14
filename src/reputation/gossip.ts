/**
 * GossipEngine — Ported from RepuNet's reputation/gossip.py
 *
 * Two-tier gossip propagation with credibility evaluation:
 * 1. First-order: gossiper selects listener, generates narrative, listener evaluates
 * 2. Second-order: listener spreads to third party with credibility decay
 */

import {
  GossipEntry,
  CredibilityLevel,
  AgentState,
  ReputationEntry,
  NumericalRecord,
} from '../types';
import { GossipDatabase } from './gossip-db';
import { ReputationDatabase, createNumericalRecord } from './reputation-db';
import { SocialNetwork } from '../network/social-network';
import { drainComplaints } from '../persona/scratch';

export interface GossipConfig {
  maxSpreadDepth: number;
  credibilityDecay: number;
  recentWindow: number;
}

export const DEFAULT_GOSSIP_CONFIG: GossipConfig = {
  maxSpreadDepth: 2,
  credibilityDecay: 0.3,
  recentWindow: 30,
};

/**
 * Result of evaluating gossip credibility.
 * In production, this would come from an LLM call.
 */
export interface GossipEvaluation {
  credibilityLevel: CredibilityLevel;
  shouldSpread: boolean;
  reasons: string;
  reputationUpdate?: Partial<NumericalRecord>;
  networkDecision?: 'disconnect' | 'connect' | 'no_change';
}

/**
 * Interface for the gossip decision-making function.
 * Can be backed by LLM or mock logic.
 */
export type GossipEvaluator = (
  listener: AgentState,
  gossipInfo: string,
  complainedName: string,
  complainedRole: string,
  existingReputation: ReputationEntry | null,
  existingGossip: GossipEntry[]
) => Promise<GossipEvaluation>;

/**
 * Default mock gossip evaluator for testing.
 * Assigns credibility based on whether the listener has prior negative experience.
 */
export const mockGossipEvaluator: GossipEvaluator = async (
  _listener,
  _gossipInfo,
  _complainedName,
  _complainedRole,
  existingReputation,
  existingGossip
) => {
  // If listener already has negative view, gossip is more credible
  let credibility: CredibilityLevel = 'credible';
  if (existingReputation) {
    const score =
      existingReputation.numericalRecord.investorSuccesses +
      existingReputation.numericalRecord.returnSuccesses -
      existingReputation.numericalRecord.trusteeFailures -
      existingReputation.numericalRecord.investmentFailures;
    if (score < 0) credibility = 'very_credible';
    else if (score > 1) credibility = 'uncredible';
  }

  // If there's prior gossip supporting this, increase credibility
  if (existingGossip.length > 0) {
    const negativeGossipCount = existingGossip.filter(
      (g) => g.credibilityLevel === 'very_credible' || g.credibilityLevel === 'credible'
    ).length;
    if (negativeGossipCount >= 2) credibility = 'very_credible';
  }

  return {
    credibilityLevel: credibility,
    shouldSpread: credibility === 'very_credible' || credibility === 'credible',
    reasons: `Evaluated based on prior reputation and gossip history.`,
    networkDecision: credibility === 'very_credible' ? 'disconnect' : 'no_change',
  };
};

export class GossipEngine {
  private config: GossipConfig;
  private evaluator: GossipEvaluator;

  constructor(
    config: Partial<GossipConfig> = {},
    evaluator?: GossipEvaluator
  ) {
    this.config = { ...DEFAULT_GOSSIP_CONFIG, ...config };
    this.evaluator = evaluator || mockGossipEvaluator;
  }

  /**
   * Execute first-order gossip for an agent with complaints.
   *
   * Flow:
   * 1. Drain complaints from gossiper's buffer
   * 2. Select listener from gossiper's connections
   * 3. For each complaint: generate gossip, listener evaluates credibility
   * 4. Update listener's reputation DB and gossip DB
   * 5. Optionally trigger network rewiring
   * 6. If marked "spread" → queue for second-order gossip
   */
  async executeFirstOrderGossip(
    gossiper: AgentState,
    allAgents: AgentState[],
    reputationDBs: Map<string, ReputationDatabase>,
    gossipDBs: Map<string, GossipDatabase>,
    network: SocialNetwork,
    currentStep: number
  ): Promise<GossipEntry[]> {
    const complaints = drainComplaints(gossiper);
    if (complaints.length === 0) return [];

    const gossiperRole = gossiper.role || 'unknown';
    const spreadQueue: GossipEntry[] = [];

    // Get potential listeners (connected agents, excluding self)
    const connections = network.getConnections(
      gossiper.name,
      gossiperRole
    );
    const listeners = allAgents.filter(
      (a) =>
        a.name !== gossiper.name &&
        connections.includes(a.name) &&
        !network.isBlackListed(a.name, gossiper.name)
    );

    if (listeners.length === 0) return [];

    // Select a listener (first available, could be LLM-selected in production)
    const listener = listeners[0];
    const listenerRepDB = reputationDBs.get(listener.name);
    const listenerGossipDB = gossipDBs.get(listener.name);

    if (!listenerRepDB || !listenerGossipDB) return [];

    for (const complaint of complaints) {
      // Parse complaint to extract target info
      // Format: "AgentName:Role:Description"
      const parts = complaint.split(':');
      if (parts.length < 3) continue;

      const complainedName = parts[0];
      const complainedRole = parts[1];
      const gossipInfo = parts.slice(2).join(':');

      // Find complained agent's ID
      const complainedAgent = allAgents.find(
        (a) => a.name === complainedName
      );
      if (!complainedAgent) continue;

      // Get listener's existing view of the complained agent
      const existingRep = listenerRepDB.getTargetReputation(
        complainedAgent.id,
        complainedRole
      );
      const existingGossip = listenerGossipDB.getTargetGossip(
        complainedAgent.id,
        complainedRole,
        currentStep,
        this.config.recentWindow
      );

      // Evaluate gossip credibility
      const evaluation = await this.evaluator(
        listener,
        gossipInfo,
        complainedName,
        complainedRole,
        existingRep,
        existingGossip
      );

      // Create gossip entry
      const gossipEntry: GossipEntry = {
        complainedName,
        complainedId: complainedAgent.id,
        complainedRole,
        gossiperRole,
        gossipInfo,
        credibilityLevel: evaluation.credibilityLevel,
        shouldSpread: evaluation.shouldSpread,
        reasons: evaluation.reasons,
        createdAtStep: currentStep,
      };

      // Store in listener's gossip DB
      listenerGossipDB.addGossip([gossipEntry], currentStep);

      // Update listener's reputation if gossip is credible
      if (
        evaluation.credibilityLevel === 'very_credible' ||
        evaluation.credibilityLevel === 'credible'
      ) {
        this.updateReputationFromGossip(
          listenerRepDB,
          complainedAgent,
          complainedRole,
          evaluation,
          currentStep
        );
      }

      // Apply network decision
      if (evaluation.networkDecision && evaluation.networkDecision !== 'no_change') {
        network.applyNetworkDecision(
          listener.name,
          complainedName,
          complainedRole,
          evaluation.networkDecision
        );
      }

      // Queue for second-order if marked to spread
      if (evaluation.shouldSpread) {
        spreadQueue.push(gossipEntry);
      }
    }

    return spreadQueue;
  }

  /**
   * Execute second-order gossip (spreading).
   * The listener from first-order becomes the gossiper for a new listener.
   * Credibility decays through the chain.
   */
  async executeSecondOrderGossip(
    spreader: AgentState,
    gossipEntries: GossipEntry[],
    allAgents: AgentState[],
    reputationDBs: Map<string, ReputationDatabase>,
    gossipDBs: Map<string, GossipDatabase>,
    network: SocialNetwork,
    currentStep: number,
    depth: number = 1
  ): Promise<void> {
    if (depth > this.config.maxSpreadDepth) return;

    const spreaderRole = spreader.role || 'unknown';
    const connections = network.getConnections(spreader.name, spreaderRole);
    const potentialListeners = allAgents.filter(
      (a) =>
        a.name !== spreader.name &&
        connections.includes(a.name) &&
        !network.isBlackListed(a.name, spreader.name)
    );

    if (potentialListeners.length === 0) return;

    // Select next listener (skip the original gossiper)
    const nextListener = potentialListeners.find(
      (a) => !gossipEntries.some((g) => g.complainedName === a.name)
    );
    if (!nextListener) return;

    const listenerRepDB = reputationDBs.get(nextListener.name);
    const listenerGossipDB = gossipDBs.get(nextListener.name);
    if (!listenerRepDB || !listenerGossipDB) return;

    const nextSpreadQueue: GossipEntry[] = [];

    for (const gossip of gossipEntries) {
      const complainedAgent = allAgents.find(
        (a) => a.name === gossip.complainedName
      );
      if (!complainedAgent) continue;

      const existingRep = listenerRepDB.getTargetReputation(
        complainedAgent.id,
        gossip.complainedRole
      );
      const existingGossip = listenerGossipDB.getTargetGossip(
        complainedAgent.id,
        gossip.complainedRole,
        currentStep,
        this.config.recentWindow
      );

      // Second-order gossip carries credibility decay info
      const decayedInfo = `[Second-hand, depth ${depth}] ${gossip.gossipInfo}`;

      const evaluation = await this.evaluator(
        nextListener,
        decayedInfo,
        gossip.complainedName,
        gossip.complainedRole,
        existingRep,
        existingGossip
      );

      // Apply credibility decay
      const decayedCredibility = this.decayCredibility(
        evaluation.credibilityLevel,
        depth
      );

      const secondOrderEntry: GossipEntry = {
        complainedName: gossip.complainedName,
        complainedId: gossip.complainedId,
        complainedRole: gossip.complainedRole,
        gossiperRole: spreaderRole,
        gossipInfo: decayedInfo,
        credibilityLevel: decayedCredibility,
        shouldSpread: evaluation.shouldSpread && depth < this.config.maxSpreadDepth,
        reasons: `Second-order (depth ${depth}): ${evaluation.reasons}`,
        createdAtStep: currentStep,
      };

      listenerGossipDB.addGossip([secondOrderEntry], currentStep);

      if (
        decayedCredibility === 'very_credible' ||
        decayedCredibility === 'credible'
      ) {
        this.updateReputationFromGossip(
          listenerRepDB,
          complainedAgent,
          gossip.complainedRole,
          evaluation,
          currentStep
        );
      }

      if (evaluation.networkDecision && evaluation.networkDecision !== 'no_change') {
        network.applyNetworkDecision(
          nextListener.name,
          gossip.complainedName,
          gossip.complainedRole,
          evaluation.networkDecision
        );
      }

      if (secondOrderEntry.shouldSpread) {
        nextSpreadQueue.push(secondOrderEntry);
      }
    }

    // Recurse for further spreading
    if (nextSpreadQueue.length > 0) {
      await this.executeSecondOrderGossip(
        nextListener,
        nextSpreadQueue,
        allAgents,
        reputationDBs,
        gossipDBs,
        network,
        currentStep,
        depth + 1
      );
    }
  }

  /** Apply credibility decay based on gossip chain depth */
  private decayCredibility(
    original: CredibilityLevel,
    depth: number
  ): CredibilityLevel {
    const levels: CredibilityLevel[] = [
      'very_credible',
      'credible',
      'uncredible',
      'very_uncredible',
    ];
    const idx = levels.indexOf(original);
    // Each depth level shifts credibility one step toward 'uncredible'
    const decaySteps = Math.floor(depth * this.config.credibilityDecay * 2);
    const newIdx = Math.min(idx + decaySteps, levels.length - 1);
    return levels[newIdx];
  }

  /** Update a reputation DB entry based on gossip evaluation */
  private updateReputationFromGossip(
    repDB: ReputationDatabase,
    complainedAgent: AgentState,
    role: string,
    evaluation: GossipEvaluation,
    step: number
  ): void {
    const existing = repDB.getTargetReputation(complainedAgent.id, role);

    const numericalRecord: NumericalRecord = existing
      ? { ...existing.numericalRecord }
      : createNumericalRecord();

    // Apply reputation adjustments from gossip
    if (evaluation.reputationUpdate) {
      for (const [key, delta] of Object.entries(evaluation.reputationUpdate)) {
        if (delta !== undefined) {
          (numericalRecord as unknown as Record<string, number>)[key] =
            ((numericalRecord as unknown as Record<string, number>)[key] || 0) + delta;
        }
      }
    } else {
      // Default: increment failure counters for credible negative gossip
      if (
        evaluation.credibilityLevel === 'very_credible' ||
        evaluation.credibilityLevel === 'credible'
      ) {
        if (role === 'trustee') {
          numericalRecord.trusteeFailures += 1;
        } else {
          numericalRecord.investmentFailures += 1;
        }
      }
    }

    const updatedEntry: ReputationEntry = {
      name: complainedAgent.name,
      id: complainedAgent.id,
      role,
      content: existing?.content || `Reputation of ${complainedAgent.name} as ${role}`,
      numericalRecord,
      reason: `Updated from gossip: ${evaluation.reasons}`,
      updatedAtStep: step,
    };

    repDB.updateReputation(repDB.getOwnerId(), updatedEntry);
  }
}
