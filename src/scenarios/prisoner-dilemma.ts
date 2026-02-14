/**
 * Prisoner's Dilemma Scenario — Ported from RepuNet's task/pd_game/
 *
 * Stages:
 * 1: Both accept to play
 * 2: Each independently chooses Cooperate/Defect
 * 3: Payoff resolution using standard PD matrix
 * 4: Reputation + Network Update + Gossip Queue
 */

import seedrandom from 'seedrandom';
import { AgentState, ScenarioResult } from '../types';
import { SocialNetwork } from '../network/social-network';
import {
  Scenario,
  ScenarioContext,
  registerScenario,
} from './scenario';
import { addComplaint } from '../persona/scratch';

/** Standard PD payoff matrix: [row player, column player] */
const PD_PAYOFFS: Record<string, Record<string, [number, number]>> = {
  cooperate: {
    cooperate: [3, 3],
    defect: [0, 5],
  },
  defect: {
    cooperate: [5, 0],
    defect: [1, 1],
  },
};

/** Mock PD decision logic */
function mockPDDecision(
  agent: AgentState,
  opponent: AgentState,
  rng: () => number
): 'cooperate' | 'defect' {
  // Rational agents defect more; altruistic agents cooperate more
  const isAltruistic = agent.learned['type'] === 'altruistic';
  const cooperateProb = isAltruistic ? 0.7 : 0.3;

  // Adjust based on past experience with opponent
  const opponentCounts = agent.successCounts[`pd-${opponent.name}`];
  if (opponentCounts && opponentCounts.total > 0) {
    const opponentCoopRate = opponentCounts.success / opponentCounts.total;
    // Tit-for-tat influence
    if (opponentCoopRate > 0.6) return rng() < 0.8 ? 'cooperate' : 'defect';
    if (opponentCoopRate < 0.3) return rng() < 0.8 ? 'defect' : 'cooperate';
  }

  return rng() < cooperateProb ? 'cooperate' : 'defect';
}

export class PrisonersDilemmaScenario implements Scenario {
  name = 'pd_game';
  roles = ['player'];

  pair(
    agents: AgentState[],
    _network: SocialNetwork,
    step: number
  ): Array<[AgentState, AgentState]> {
    const rng = seedrandom(`pd-pair-${step}`);
    const shuffled = [...agents];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const pairs: Array<[AgentState, AgentState]> = [];
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      shuffled[i].role = 'player';
      shuffled[i + 1].role = 'player';
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }
    return pairs;
  }

  async execute(
    pair: [AgentState, AgentState],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [playerA, playerB] = pair;
    const rng = seedrandom(
      `pd-${context.step}-${playerA.id}-${playerB.id}`
    );
    const history: string[] = [];

    // Stage 1: Both accept to play
    history.push(
      `Step ${context.step}: ${playerA.name} and ${playerB.name} engage in PD game`
    );

    // Stage 2: Independent choices
    const actionA = mockPDDecision(playerA, playerB, rng);
    const actionB = mockPDDecision(playerB, playerA, rng);

    history.push(
      `${playerA.name} chose: ${actionA}, ${playerB.name} chose: ${actionB}`
    );

    // Stage 3: Payoff resolution
    const [payoffA, payoffB] = PD_PAYOFFS[actionA][actionB];

    history.push(`Payoffs: ${playerA.name}=${payoffA}, ${playerB.name}=${payoffB}`);

    // Track cooperation for tit-for-tat
    if (!playerA.successCounts[`pd-${playerB.name}`]) {
      playerA.successCounts[`pd-${playerB.name}`] = { total: 0, success: 0 };
    }
    playerA.successCounts[`pd-${playerB.name}`].total += 1;
    if (actionB === 'cooperate') {
      playerA.successCounts[`pd-${playerB.name}`].success += 1;
    }

    if (!playerB.successCounts[`pd-${playerA.name}`]) {
      playerB.successCounts[`pd-${playerA.name}`] = { total: 0, success: 0 };
    }
    playerB.successCounts[`pd-${playerA.name}`].total += 1;
    if (actionA === 'cooperate') {
      playerB.successCounts[`pd-${playerA.name}`].success += 1;
    }

    // Stage 4: Gossip queue — defection against cooperator generates complaints
    if (actionB === 'defect' && actionA === 'cooperate') {
      addComplaint(
        playerA,
        `${playerB.name}:player:Defected while I cooperated in PD game`
      );
    }
    if (actionA === 'defect' && actionB === 'cooperate') {
      addComplaint(
        playerB,
        `${playerA.name}:player:Defected while I cooperated in PD game`
      );
    }

    return {
      payoffs: {
        [playerA.name]: payoffA,
        [playerB.name]: payoffB,
      },
      actions: {
        [playerA.name]: actionA,
        [playerB.name]: actionB,
      },
      history,
      metadata: {
        actionA,
        actionB,
        mutualCooperation: actionA === 'cooperate' && actionB === 'cooperate',
        mutualDefection: actionA === 'defect' && actionB === 'defect',
      },
    };
  }

  async updateReputation(
    _pair: [AgentState, AgentState],
    _result: ScenarioResult,
    _context: ScenarioContext
  ): Promise<void> {
    // Reputation updates handled by reputation-update.ts
  }
}

registerScenario(new PrisonersDilemmaScenario());
