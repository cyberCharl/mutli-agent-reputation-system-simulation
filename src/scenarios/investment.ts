/**
 * Investment Game Scenario — Ported from RepuNet's task/investment/
 *
 * 4-stage investment game:
 * Stage 0: Investor decides Accept/Refuse
 * Stage 1: Investor allocates 1-10 units
 * Stage 3: Trustee returns 0%/25%/75%/100%/150%
 * Stage 4: Reputation + Network Update
 *
 * Uses mock decision logic; LLM integration follows MSPN's structured JSON pattern.
 */

import seedrandom from 'seedrandom';
import { AgentState, ScenarioResult } from '../types';
import { SocialNetwork } from '../network/social-network';
import {
  Scenario,
  ScenarioContext,
  registerScenario,
} from './scenario';
import { ReputationDatabase, computeAggregateScore } from '../reputation/reputation-db';
import { updateReputationInvestment } from '../reputation/reputation-update';
import { addComplaint, recordObservation } from '../persona/scratch';

const MULTIPLIER = 3;
const RETURN_OPTIONS = [0, 0.25, 0.75, 1.0, 1.5];

/** Reputation-weighted pairing: higher-reputation investors pick first */
function reputationWeightedPairing(
  agents: AgentState[],
  network: SocialNetwork,
  step: number
): Array<[AgentState, AgentState]> {
  const rng = seedrandom(`invest-pair-${step}`);
  const half = Math.floor(agents.length / 2);

  // Shuffle and split into investors and trustees
  const shuffled = [...agents];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const investors = shuffled.slice(0, half);
  const trustees = shuffled.slice(half, half * 2);

  // Sort investors by reputation (descending) — higher rep picks first
  // This is a simplified version; full version would use ReputationDB scores
  investors.sort((a, b) => {
    const scoreA = (a.successCounts['investor']?.success || 0) /
      Math.max(1, a.successCounts['investor']?.total || 1);
    const scoreB = (b.successCounts['investor']?.success || 0) /
      Math.max(1, b.successCounts['investor']?.total || 1);
    return scoreB - scoreA;
  });

  const pairs: Array<[AgentState, AgentState]> = [];
  const usedTrustees = new Set<number>();

  for (const investor of investors) {
    // Find available trustee (prefer connected, avoid blacklisted)
    const connected = network.getConnections(investor.name, 'investor');
    let selectedTrustee: AgentState | null = null;

    // 50% chance to pick from connections (mirrors RepuNet)
    if (rng() < 0.5 && connected.length > 0) {
      for (const connName of connected) {
        const t = trustees.find(
          (t) => t.name === connName && !usedTrustees.has(t.id)
        );
        if (t) {
          selectedTrustee = t;
          break;
        }
      }
    }

    // Fallback: random from available
    if (!selectedTrustee) {
      const available = trustees.filter((t) => !usedTrustees.has(t.id));
      if (available.length > 0) {
        selectedTrustee = available[Math.floor(rng() * available.length)];
      }
    }

    if (selectedTrustee) {
      usedTrustees.add(selectedTrustee.id);
      investor.role = 'investor';
      selectedTrustee.role = 'trustee';
      pairs.push([investor, selectedTrustee]);
    }
  }

  return pairs;
}

export class InvestmentScenario implements Scenario {
  name = 'investment';
  roles = ['investor', 'trustee'];

  pair(
    agents: AgentState[],
    network: SocialNetwork,
    step: number
  ): Array<[AgentState, AgentState]> {
    return reputationWeightedPairing(agents, network, step);
  }

  async execute(
    pair: [AgentState, AgentState],
    context: ScenarioContext
  ): Promise<ScenarioResult> {
    const [investor, trustee] = pair;
    const rng = seedrandom(
      `invest-${context.step}-${investor.id}-${trustee.id}`
    );

    const history: string[] = [];

    // Stage 0: Investor decides Accept/Refuse
    const acceptProb = 0.8; // Most investors accept
    const accepted = rng() < acceptProb;

    if (!accepted) {
      history.push(`${investor.name} refused to invest with ${trustee.name}`);
      return {
        payoffs: { [investor.name]: 0, [trustee.name]: 0 },
        actions: {
          [investor.name]: 'refuse',
          [trustee.name]: 'none',
          investor: 'refuse',
          trustee: 'none',
        },
        history,
        metadata: { stage: 0, accepted: false },
      };
    }

    // Stage 1: Investor allocates 1-10 units
    const maxAllocation = Math.min(investor.resourcesUnit, 10);
    const allocation = Math.max(1, Math.floor(rng() * maxAllocation) + 1);
    const trusteeReceives = allocation * MULTIPLIER;

    history.push(
      `${investor.name} invested ${allocation} units (${trustee.name} receives ${trusteeReceives})`
    );

    // Stage 3: Trustee returns a portion
    const returnOptionIdx = Math.floor(rng() * RETURN_OPTIONS.length);
    const returnRate = RETURN_OPTIONS[returnOptionIdx];
    const returnAmount = Math.floor(trusteeReceives * returnRate);

    history.push(
      `${trustee.name} returned ${returnRate * 100}% = ${returnAmount} units`
    );

    // Calculate payoffs
    const investorPayoff = returnAmount - allocation;
    const trusteePayoff = trusteeReceives - returnAmount;

    // Update resources
    investor.resourcesUnit += investorPayoff;
    trustee.resourcesUnit += trusteePayoff;

    history.push(
      `Payoffs: ${investor.name}=${investorPayoff}, ${trustee.name}=${trusteePayoff}`
    );

    // Generate complaints if bad return
    if (returnRate <= 0.25) {
      addComplaint(
        investor,
        `${trustee.name}:trustee:Returned only ${returnRate * 100}% of invested amount`
      );
    }

    // Record observations for other agents (every N steps)
    if (context.step % (context.config.networkConfig?.observationInterval || 5) === 0) {
      // Other agents observe this interaction
      for (const agent of [investor, trustee]) {
        recordObservation(agent, `invest-${context.step}-${investor.id}`, {
          targetName: trustee.name,
          targetId: trustee.id,
          role: 'trustee',
          behavior: `Returned ${returnRate * 100}% in investment game`,
          outcome: returnRate >= 0.75 ? 'positive' : 'negative',
        });
      }
    }

    return {
      payoffs: {
        [investor.name]: investorPayoff,
        [trustee.name]: trusteePayoff,
      },
      actions: {
        [investor.name]: String(allocation),
        [trustee.name]: `${returnRate * 100}%`,
        investor: String(allocation),
        trustee: `${returnRate * 100}%`,
      },
      history,
      metadata: {
        stage: 4,
        accepted: true,
        allocation,
        trusteeReceives,
        returnRate,
        returnAmount,
      },
    };
  }

  async updateReputation(
    pair: [AgentState, AgentState],
    result: ScenarioResult,
    context: ScenarioContext
  ): Promise<void> {
    if (!context.reputationBackend) return;

    // Use the reputation-update module for structured updates
    // This would be wired to actual ReputationDatabase instances in the simulator
  }
}

registerScenario(new InvestmentScenario());
