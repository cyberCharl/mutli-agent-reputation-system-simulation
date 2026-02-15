import { NestedBelief, ProtocolLevel, ReviewAction } from './types';

export const PROPOSAL_PROMPT = `You are Agent A (Proposer) in the Misaligned Secure Protocol Negotiation (MSPN) game. Your goal is to propose a protocol level (low/medium/high) for secure data sharing.

Your nested belief about the true state:
- Own belief: {{belief}}
- Your belief about what Agent B thinks: {{opponentBelief}}

Game history: {{history}}

Consider your nested beliefs and security risks. You want to maximize payoff but avoid breaches. Low protocol is risky but fast if the state is safe, while high protocol is secure but slower.

Respond ONLY with valid JSON in this exact format: {"action": "low"} or {"action": "medium"} or {"action": "high"}

Examples:
1. Belief strongly favors safe state (own: 0.8 safe, opponent: 0.7 safe). Empty history. 
   → {"action": "low"} (risky but fast if safe)

2. Belief suggests dangerous state (own: 0.3 safe, opponent: 0.4 safe). 
   → {"action": "medium"} (balanced approach)

3. Strong belief in danger, opponent also cautious. 
   → {"action": "high"} (prioritize security)

Remember: You must respond with valid JSON only.`;

export const REVIEW_PROMPT = `You are Agent B (Reviewer) in the MSPN game. Agent A has proposed: {{proposal}}

Your nested belief about the true state:
- Own belief: {{belief}}
- Your belief about what Agent A thinks: {{opponentBelief}}

Game history: {{history}}

Available actions:
- "accept": Accept the proposal as-is
- "modify-low": Change to low protocol
- "modify-medium": Change to medium protocol  
- "modify-high": Change to high protocol
- "reject": Reject and end with low payoffs

Consider if Agent A might be deceiving you based on your meta-belief about A's belief. Prioritize security but also consider cooperation.

Respond ONLY with valid JSON in this exact format: {"action": "accept"} (or modify-low, modify-medium, modify-high, reject)

Examples:
1. Proposal: low, your belief strongly favors dangerous state (0.2 safe)
   → {"action": "reject"} (avoid potential breach)

2. Proposal: medium, your belief favors safe state (0.7 safe)
   → {"action": "accept"} (reasonable proposal)

3. Proposal: high, your belief is uncertain (0.5 safe) but A seems cautious
   → {"action": "accept"} (security-focused proposal)

4. Proposal: low, your belief is mixed (0.6 safe) but A's meta-belief suggests A thinks it's safe
   → {"action": "modify-medium"} (compromise)

Remember: You must respond with valid JSON only.`;

export function formatProposalPrompt(
  belief: NestedBelief,
  history: string[],
  reputationWarning?: string,
  karma?: number,
  opponentKarma?: number
): string {
  const historyStr = history.length > 0 ? history.join('; ') : 'None';
  const warning = reputationWarning ? `\n\nWARNING: ${reputationWarning}` : '';

  let karmaContext = '';
  if (karma !== undefined) {
    karmaContext = `\n\nYour current karma: ${karma}/100.`;
    if (karma < 30) {
      karmaContext += ' WARNING: Low karma may result in blocked actions.';
    }
    if (opponentKarma !== undefined) {
      karmaContext += `\nOpponent karma: ${opponentKarma}/100.`;
    }
  }

  return (
    PROPOSAL_PROMPT.replace('{{belief}}', JSON.stringify(belief.own))
      .replace('{{opponentBelief}}', JSON.stringify(belief.aboutOpponent))
      .replace('{{history}}', historyStr) +
    karmaContext +
    warning
  );
}

export function formatReviewPrompt(
  proposal: ProtocolLevel,
  belief: NestedBelief,
  history: string[],
  karma?: number,
  opponentKarma?: number
): string {
  const historyStr = history.length > 0 ? history.join('; ') : 'None';

  let karmaContext = '';
  if (karma !== undefined) {
    karmaContext = `\n\nYour current karma: ${karma}/100.`;
    if (karma < 30) {
      karmaContext += ' WARNING: Low karma may result in blocked actions.';
    }
    if (opponentKarma !== undefined) {
      karmaContext += `\nOpponent karma: ${opponentKarma}/100.`;
    }
  }

  return (
    REVIEW_PROMPT.replace('{{proposal}}', proposal)
      .replace('{{belief}}', JSON.stringify(belief.own))
      .replace('{{opponentBelief}}', JSON.stringify(belief.aboutOpponent))
      .replace('{{history}}', historyStr) + karmaContext
  );
}

export interface NetworkDecisionPromptInput {
  actorName: string;
  actorRole?: string;
  targetName: string;
  currentConnections: string[];
  blackList: string[];
  context?: string;
}

export function buildNetworkDecisionPrompt(
  input: NetworkDecisionPromptInput
): string {
  const connections =
    input.currentConnections.length > 0
      ? input.currentConnections.join(', ')
      : 'None';
  const blocked =
    input.blackList.length > 0 ? input.blackList.join(', ') : 'None';
  const roleLine = input.actorRole ? ` (${input.actorRole})` : '';
  const contextLine = input.context ? `\nContext: ${input.context}` : '';

  return [
    `You are ${input.actorName}${roleLine} deciding social-network rewiring.`,
    `Target agent: ${input.targetName}.`,
    `Current connections: ${connections}.`,
    `Blacklist (cannot connect): ${blocked}.`,
    'Decide whether to connect and/or disconnect based on trust, utility, and risk.',
    'Return strict JSON: {"shouldDisconnect": boolean, "shouldConnect": boolean, "reasoning": string, "trustLevel": number}.',
    contextLine,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export interface GossipEvaluationPromptInput {
  listenerName: string;
  gossiperName: string;
  targetName: string;
  gossipInfo: string;
  sourceChain?: string[];
  credibilityHint?: string;
}

export function buildGossipEvaluationPrompt(
  input: GossipEvaluationPromptInput
): string {
  const chain =
    input.sourceChain && input.sourceChain.length > 0
      ? input.sourceChain.join(' -> ')
      : input.gossiperName;
  const hint = input.credibilityHint
    ? `\nCredibility hint from prior hop: ${input.credibilityHint}.`
    : '';

  return [
    `You are ${input.listenerName} evaluating gossip credibility.`,
    `Gossiper: ${input.gossiperName}. Target: ${input.targetName}.`,
    `Gossip content: ${input.gossipInfo}`,
    `Source chain: ${chain}.`,
    'Assess credibility and whether this gossip should spread further.',
    'Return strict JSON: {"credibilityLevel":"very_credible|credible|uncredible|very_uncredible","shouldSpread":boolean,"reasoning":string,"reputationAdjustment":number}.',
    hint,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export function buildInvestmentAcceptPrompt(input: {
  investorName: string;
  trusteeName: string;
  trustScore: number;
  step: number;
}): string {
  return [
    `You are ${input.investorName} deciding whether to invest with ${input.trusteeName}.`,
    `Current trust score: ${input.trustScore.toFixed(3)}.`,
    `Step: ${input.step}.`,
    'Return strict JSON: {"accept": boolean, "reasoning": string}.',
  ].join('\n');
}

export function buildInvestmentAmountPrompt(input: {
  investorName: string;
  trusteeName: string;
  trustScore: number;
  step: number;
}): string {
  return [
    `You are ${input.investorName} choosing an investment amount for ${input.trusteeName}.`,
    `Current trust score: ${input.trustScore.toFixed(3)}.`,
    `Step: ${input.step}.`,
    'Return strict JSON: {"amount": number, "reasoning": string} where amount is 1..10.',
  ].join('\n');
}

export function buildReturnDecisionPrompt(input: {
  trusteeName: string;
  investorName: string;
  amountReceived: number;
  trustScore: number;
  step: number;
}): string {
  return [
    `You are ${input.trusteeName} deciding return percentage to ${input.investorName}.`,
    `Amount received: ${input.amountReceived}. Trust score: ${input.trustScore.toFixed(3)}.`,
    `Step: ${input.step}.`,
    'Return strict JSON: {"percentage":"0|25|75|100|150", "reasoning": string}.',
  ].join('\n');
}

export function buildPDDecisionPrompt(input: {
  selfName: string;
  opponentName: string;
  trustScore: number;
  step: number;
}): string {
  return [
    `You are ${input.selfName} playing a one-shot prisoner's dilemma with ${input.opponentName}.`,
    `Trust score: ${input.trustScore.toFixed(3)}. Step: ${input.step}.`,
    'Return strict JSON: {"action":"cooperate|defect", "reasoning": string}.',
  ].join('\n');
}

export function buildSignUpDecisionPrompt(input: {
  selfName: string;
  partnerName: string;
  trustScore: number;
  step: number;
}): string {
  return [
    `You are ${input.selfName} deciding whether to sign up with ${input.partnerName}.`,
    `Trust score: ${input.trustScore.toFixed(3)}. Step: ${input.step}.`,
    'Return strict JSON: {"action":"sign_up|wait", "reasoning": string}.',
  ].join('\n');
}
