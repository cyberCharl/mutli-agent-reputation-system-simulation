/**
 * Sign-up/Chat Scenario — Ported from RepuNet's task/sign_up/
 *
 * Stages:
 * - Every 5 steps: New agent "signs up", existing agents update reputations
 * - Each step: Chat phase with random pairing
 * - Each decides to chat based on partner's reputation
 * - If both accept: generate conversation, summarize
 * - Update reputations based on chat quality
 * - Network rewires + optional gossip
 */

import seedrandom from 'seedrandom';
import { AgentState, ScenarioResult } from '../types';
import { SocialNetwork } from '../network/social-network';
import {
  Scenario,
  ScenarioContext,
  registerScenario,
} from './scenario';
import { addComplaint, recordOutcome } from '../persona/scratch';

/** Mock decision: whether agent wants to chat with target */
function mockDecideToChat(
  agent: AgentState,
  target: AgentState,
  rng: () => number
): boolean {
  // Base willingness
  let willingness = 0.7;

  // Altruistic agents more willing
  if (agent.learned['type'] === 'altruistic') willingness += 0.1;

  // If on black list, much less willing
  if (agent.relationship.blackList.includes(target.name)) {
    willingness = 0.1;
  }

  // Past success rate affects willingness
  const pastChats = agent.successCounts[`chat-${target.name}`];
  if (pastChats && pastChats.total > 0) {
    const successRate = pastChats.success / pastChats.total;
    willingness = willingness * 0.5 + successRate * 0.5;
  }

  return rng() < willingness;
}

/** Mock conversation generation */
function mockGenerateConversation(
  agentA: AgentState,
  agentB: AgentState,
  rng: () => number
): { quality: 'good' | 'neutral' | 'bad'; summary: string } {
  const roll = rng();
  if (roll < 0.4) {
    return {
      quality: 'good',
      summary: `${agentA.name} and ${agentB.name} had a productive and friendly conversation.`,
    };
  } else if (roll < 0.8) {
    return {
      quality: 'neutral',
      summary: `${agentA.name} and ${agentB.name} had a brief, unremarkable exchange.`,
    };
  } else {
    return {
      quality: 'bad',
      summary: `${agentA.name} and ${agentB.name} had a disagreement during their conversation.`,
    };
  }
}

export class SignUpScenario implements Scenario {
  name = 'sign_up';
  roles = ['resident'];

  pair(
    agents: AgentState[],
    _network: SocialNetwork,
    step: number
  ): Array<[AgentState, AgentState]> {
    const rng = seedrandom(`signup-pair-${step}`);
    const shuffled = [...agents];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const pairs: Array<[AgentState, AgentState]> = [];
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      shuffled[i].role = 'resident';
      shuffled[i + 1].role = 'resident';
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }
    return pairs;
  }

  async execute(
    pair: [AgentState, AgentState],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [agentA, agentB] = pair;
    const rng = seedrandom(
      `signup-${context.step}-${agentA.id}-${agentB.id}`
    );
    const history: string[] = [];

    // Decide to chat
    const aWantsChat = mockDecideToChat(agentA, agentB, rng);
    const bWantsChat = mockDecideToChat(agentB, agentA, rng);

    if (!aWantsChat || !bWantsChat) {
      const refuser = !aWantsChat ? agentA.name : agentB.name;
      history.push(`${refuser} declined to chat`);

      // Track refusal
      if (!aWantsChat) {
        if (!agentB.successCounts[`chat-${agentA.name}`]) {
          agentB.successCounts[`chat-${agentA.name}`] = { total: 0, success: 0 };
        }
        agentB.successCounts[`chat-${agentA.name}`].total += 1;
      }
      if (!bWantsChat) {
        if (!agentA.successCounts[`chat-${agentB.name}`]) {
          agentA.successCounts[`chat-${agentB.name}`] = { total: 0, success: 0 };
        }
        agentA.successCounts[`chat-${agentB.name}`].total += 1;
      }

      return {
        payoffs: { [agentA.name]: 0, [agentB.name]: 0 },
        actions: {
          [agentA.name]: aWantsChat ? 'accept' : 'refuse',
          [agentB.name]: bWantsChat ? 'accept' : 'refuse',
        },
        history,
        metadata: { chatOccurred: false },
      };
    }

    // Both accepted — generate conversation
    history.push(`${agentA.name} and ${agentB.name} begin chatting`);

    const convo = mockGenerateConversation(agentA, agentB, rng);
    history.push(convo.summary);

    // Payoffs based on chat quality
    const payoffMap = { good: 3, neutral: 1, bad: -1 };
    const payoff = payoffMap[convo.quality];

    // Track success
    const isSuccess = convo.quality === 'good';
    recordOutcome(agentA, `chat-${agentB.name}`, isSuccess);
    recordOutcome(agentB, `chat-${agentA.name}`, isSuccess);

    // Generate complaints for bad conversations
    if (convo.quality === 'bad') {
      addComplaint(
        agentA,
        `${agentB.name}:resident:Had a bad conversation experience`
      );
      addComplaint(
        agentB,
        `${agentA.name}:resident:Had a bad conversation experience`
      );
    }

    return {
      payoffs: {
        [agentA.name]: payoff,
        [agentB.name]: payoff,
      },
      actions: {
        [agentA.name]: 'chat',
        [agentB.name]: 'chat',
      },
      history,
      metadata: {
        chatOccurred: true,
        quality: convo.quality,
        summary: convo.summary,
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

registerScenario(new SignUpScenario());
