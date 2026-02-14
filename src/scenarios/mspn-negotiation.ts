/**
 * MSPN Negotiation Scenario — Extracted from existing game.ts as a scenario plugin.
 *
 * This preserves the existing MSPN 2-agent negotiation game logic
 * while conforming to the Scenario interface for pluggable execution.
 */

import seedrandom from 'seedrandom';
import { AgentState, ScenarioResult } from '../types';
import { SocialNetwork } from '../network/social-network';
import { Scenario, ScenarioContext, registerScenario } from './scenario';

/** MSPN-specific payoff matrix */
const PAYOFF_MATRIX: Record<string, Record<string, [number, number]>> = {
  high: { safe: [10, 10], dangerous: [10, 10] },
  medium: { safe: [10, 10], dangerous: [10, 10] },
  low: { safe: [12, 8], dangerous: [-5, -5] },
  reject: { safe: [2, 2], dangerous: [2, 2] },
};

/** Mock decision logic for MSPN (mirrors existing agent.ts mock behavior) */
function mockMSPNDecision(
  role: 'proposer' | 'reviewer',
  rng: () => number,
  proposal?: string
): string {
  const roll = rng();
  if (role === 'proposer') {
    if (roll < 0.4) return 'medium';
    if (roll < 0.7) return 'high';
    return 'low';
  } else {
    // Reviewer
    if (proposal === 'low') {
      return roll < 0.5 ? 'reject' : 'accept';
    }
    return roll < 0.8 ? 'accept' : 'modify-medium';
  }
}

export class MSPNNegotiationScenario implements Scenario {
  name = 'mspn';
  roles = ['proposer', 'reviewer'];

  pair(
    agents: AgentState[],
    _network: SocialNetwork,
    _step: number
  ): Array<[AgentState, AgentState]> {
    // MSPN is a 2-agent game: first agent proposes, second reviews
    if (agents.length < 2) return [];
    // For multi-agent: create random pairings
    const shuffled = [...agents];
    const rng = seedrandom(`mspn-pair-${_step}`);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const pairs: Array<[AgentState, AgentState]> = [];
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }
    return pairs;
  }

  async execute(
    pair: [AgentState, AgentState],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [proposer, reviewer] = pair;
    const rng = seedrandom(`mspn-${context.step}-${proposer.id}-${reviewer.id}`);

    // Determine true state
    const trueState = rng() < 0.5 ? 'safe' : 'dangerous';

    // Proposer decides protocol level
    const proposal = mockMSPNDecision('proposer', rng);

    // Reviewer decides
    const review = mockMSPNDecision('reviewer', rng, proposal);

    // Resolve
    let finalProtocol: string;
    if (review === 'accept') {
      finalProtocol = proposal;
    } else if (review === 'reject') {
      finalProtocol = 'reject';
    } else if (review.startsWith('modify-')) {
      finalProtocol = review.replace('modify-', '');
    } else {
      finalProtocol = 'medium';
    }

    // Calculate payoffs
    const payoffs = PAYOFF_MATRIX[finalProtocol]?.[trueState] || [2, 2];

    return {
      payoffs: {
        [proposer.name]: payoffs[0],
        [reviewer.name]: payoffs[1],
      },
      actions: {
        [proposer.name]: proposal,
        [reviewer.name]: review,
        proposer: proposal,
        reviewer: review,
      },
      history: [
        `Step ${context.step}: ${proposer.name} proposed ${proposal}`,
        `${reviewer.name} responded: ${review}`,
        `Final protocol: ${finalProtocol}, True state: ${trueState}`,
        `Payoffs: ${proposer.name}=${payoffs[0]}, ${reviewer.name}=${payoffs[1]}`,
      ],
      metadata: {
        trueState,
        finalProtocol,
        proposal,
        review,
      },
    };
  }

  async updateReputation(
    _pair: [AgentState, AgentState],
    _result: ScenarioResult,
    _context: ScenarioContext
  ): Promise<void> {
    // MSPN uses the existing karma-based reputation system
    // Updates handled by the existing ReputationSystem class
  }
}

// Register the scenario
registerScenario(new MSPNNegotiationScenario());
