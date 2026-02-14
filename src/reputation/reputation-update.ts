/**
 * ReputationUpdater — Ported from RepuNet's reputation/reputation_update.py
 *
 * Post-interaction reputation update orchestration.
 * Coordinates reputation updates, learned trait updates, and observation processing.
 */

import {
  AgentState,
  NumericalRecord,
  ReputationEntry,
  ScenarioResult,
} from '../types';
import { ReputationDatabase, createNumericalRecord, computeAggregateScore } from './reputation-db';
import { recordOutcome, updateLearned } from '../persona/scratch';

/**
 * Update reputation after an investment game interaction.
 * Mirrors RepuNet's reputation_update_invest().
 */
export function updateReputationInvestment(
  investor: AgentState,
  trustee: AgentState,
  result: ScenarioResult,
  investorRepDB: ReputationDatabase,
  trusteeRepDB: ReputationDatabase,
  step: number
): void {
  const investorAction = result.actions['investor'] || '';
  const trusteeAction = result.actions['trustee'] || '';
  const investorPayoff = result.payoffs[investor.name] || 0;

  // Investor updates reputation of trustee
  const existingTrusteeRep = investorRepDB.getTargetReputation(
    trustee.id,
    'trustee'
  );
  const trusteeRecord: NumericalRecord = existingTrusteeRep
    ? { ...existingTrusteeRep.numericalRecord }
    : createNumericalRecord();

  if (investorPayoff <= 0) {
    // Bad return from trustee
    trusteeRecord.trusteeFailures += 1;
    trusteeRecord.returnIssues += 1;
  } else if (investorPayoff > 0) {
    trusteeRecord.returnSuccesses += 1;
  }

  const trusteeEntry: ReputationEntry = {
    name: trustee.name,
    id: trustee.id,
    role: 'trustee',
    content: `${trustee.name} as trustee: ${trusteeAction}`,
    numericalRecord: trusteeRecord,
    reason: `Investment result: payoff=${investorPayoff}`,
    updatedAtStep: step,
  };
  investorRepDB.updateReputation(investor.name, trusteeEntry);

  // Trustee updates reputation of investor
  const existingInvestorRep = trusteeRepDB.getTargetReputation(
    investor.id,
    'investor'
  );
  const investorRecord: NumericalRecord = existingInvestorRep
    ? { ...existingInvestorRep.numericalRecord }
    : createNumericalRecord();

  if (investorAction === 'refuse' || investorAction === '0') {
    investorRecord.investmentFailures += 1;
  } else {
    investorRecord.investorSuccesses += 1;
  }

  const investorEntry: ReputationEntry = {
    name: investor.name,
    id: investor.id,
    role: 'investor',
    content: `${investor.name} as investor: ${investorAction}`,
    numericalRecord: investorRecord,
    reason: `Investment interaction completed`,
    updatedAtStep: step,
  };
  trusteeRepDB.updateReputation(trustee.name, investorEntry);

  // Update success counts
  const investorSuccess = investorPayoff > 0;
  recordOutcome(investor, 'investor', investorSuccess);
  recordOutcome(trustee, 'trustee', investorSuccess);
}

/**
 * Update reputation after a Prisoner's Dilemma game.
 * Mirrors RepuNet's reputation_update_pd_game().
 */
export function updateReputationPD(
  playerA: AgentState,
  playerB: AgentState,
  result: ScenarioResult,
  repDBA: ReputationDatabase,
  repDBB: ReputationDatabase,
  step: number
): void {
  const actionA = result.actions[playerA.name] || 'defect';
  const actionB = result.actions[playerB.name] || 'defect';

  // Player A updates reputation of Player B
  const existingRepB = repDBA.getTargetReputation(playerB.id, 'player');
  const recordB: NumericalRecord = existingRepB
    ? { ...existingRepB.numericalRecord }
    : createNumericalRecord();

  if (actionB === 'cooperate') {
    recordB.returnSuccesses += 1;
    recordB.investorSuccesses += 1;
  } else {
    recordB.trusteeFailures += 1;
  }

  repDBA.updateReputation(playerA.name, {
    name: playerB.name,
    id: playerB.id,
    role: 'player',
    content: `${playerB.name} chose ${actionB} in PD`,
    numericalRecord: recordB,
    reason: `PD game: ${playerB.name} ${actionB}`,
    updatedAtStep: step,
  });

  // Player B updates reputation of Player A
  const existingRepA = repDBB.getTargetReputation(playerA.id, 'player');
  const recordA: NumericalRecord = existingRepA
    ? { ...existingRepA.numericalRecord }
    : createNumericalRecord();

  if (actionA === 'cooperate') {
    recordA.returnSuccesses += 1;
    recordA.investorSuccesses += 1;
  } else {
    recordA.trusteeFailures += 1;
  }

  repDBB.updateReputation(playerB.name, {
    name: playerA.name,
    id: playerA.id,
    role: 'player',
    content: `${playerA.name} chose ${actionA} in PD`,
    numericalRecord: recordA,
    reason: `PD game: ${playerA.name} ${actionA}`,
    updatedAtStep: step,
  });

  // Generate complaints for gossip if defected against cooperator
  if (actionB === 'defect' && actionA === 'cooperate') {
    playerA.complainBuffer.push(
      `${playerB.name}:player:Defected while I cooperated in PD game`
    );
  }
  if (actionA === 'defect' && actionB === 'cooperate') {
    playerB.complainBuffer.push(
      `${playerA.name}:player:Defected while I cooperated in PD game`
    );
  }
}

/**
 * Update reputation after a sign-up/chat interaction.
 * Mirrors RepuNet's reputation_update_sign_up().
 */
export function updateReputationSignUp(
  agentA: AgentState,
  agentB: AgentState,
  result: ScenarioResult,
  repDBA: ReputationDatabase,
  repDBB: ReputationDatabase,
  step: number
): void {
  const actionA = result.actions[agentA.name] || '';
  const actionB = result.actions[agentB.name] || '';

  // Update based on chat quality/willingness
  const chatSuccess = actionA !== 'refuse' && actionB !== 'refuse';

  // Agent A updates rep of Agent B
  const existingRepB = repDBA.getTargetReputation(agentB.id, 'resident');
  const recordB: NumericalRecord = existingRepB
    ? { ...existingRepB.numericalRecord }
    : createNumericalRecord();

  if (chatSuccess) {
    recordB.returnSuccesses += 1;
  } else if (actionB === 'refuse') {
    recordB.trusteeFailures += 1;
  }

  repDBA.updateReputation(agentA.name, {
    name: agentB.name,
    id: agentB.id,
    role: 'resident',
    content: `${agentB.name} in chat: ${actionB}`,
    numericalRecord: recordB,
    reason: `Chat interaction`,
    updatedAtStep: step,
  });

  // Agent B updates rep of Agent A
  const existingRepA = repDBB.getTargetReputation(agentA.id, 'resident');
  const recordA: NumericalRecord = existingRepA
    ? { ...existingRepA.numericalRecord }
    : createNumericalRecord();

  if (chatSuccess) {
    recordA.returnSuccesses += 1;
  } else if (actionA === 'refuse') {
    recordA.trusteeFailures += 1;
  }

  repDBB.updateReputation(agentB.name, {
    name: agentA.name,
    id: agentA.id,
    role: 'resident',
    content: `${agentA.name} in chat: ${actionA}`,
    numericalRecord: recordA,
    reason: `Chat interaction`,
    updatedAtStep: step,
  });

  recordOutcome(agentA, 'resident', chatSuccess);
  recordOutcome(agentB, 'resident', chatSuccess);
}

/**
 * Process observation-based reputation updates.
 * Every N steps, agents update reputations of agents they've observed.
 * Mirrors RepuNet's observation-based reputation (Section 4.5).
 */
export function processObservationUpdates(
  observer: AgentState,
  repDB: ReputationDatabase,
  step: number
): void {
  for (const [key, data] of Object.entries(observer.observed)) {
    const obs = data as {
      targetName: string;
      targetId: number;
      role: string;
      behavior: string;
      outcome: 'positive' | 'negative';
    };

    const existing = repDB.getTargetReputation(obs.targetId, obs.role);
    const record: NumericalRecord = existing
      ? { ...existing.numericalRecord }
      : createNumericalRecord();

    if (obs.outcome === 'positive') {
      record.returnSuccesses += 1;
    } else {
      record.trusteeFailures += 1;
    }

    repDB.updateReputation(observer.name, {
      name: obs.targetName,
      id: obs.targetId,
      role: obs.role,
      content: `Observed ${obs.targetName}: ${obs.behavior}`,
      numericalRecord: record,
      reason: `Observation-based update at step ${step}`,
      updatedAtStep: step,
    });
  }

  // Clear observations after processing
  observer.observed = {};
}
