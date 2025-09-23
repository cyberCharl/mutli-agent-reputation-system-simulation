export enum ProtocolLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum ReviewAction {
  Accept = 'accept',
  ModifyLow = 'modify-low',
  ModifyMedium = 'modify-medium',
  ModifyHigh = 'modify-high',
  Reject = 'reject',
}

export enum TrueState {
  SafeLow = 'risk-low-safe',
  DangerousLow = 'risk-low-dangerous',
}

export enum Phase {
  Proposal = 'proposal',
  Review = 'review',
  Execution = 'execution',
  End = 'end',
}

export interface NestedBelief {
  own: Record<TrueState, number>;
  aboutOpponent: Record<TrueState, number>;
}

export interface GameState {
  trueState: TrueState;
  phase: Phase;
  proposal?: ProtocolLevel;
  reviewAction?: ReviewAction;
  finalProtocol?: ProtocolLevel;
  agentBeliefs: { a: NestedBelief; b: NestedBelief };
  history: string[];
  payoffs: { a: number; b: number } | null;
}

export type AgentId = 'A' | 'B';

export interface ModelRep {
  id: string;
  karma: number;
}

export interface ReputationConsequences {
  blockedActions: ProtocolLevel[];
  payoffPenalty: number;
  autoReject: boolean;
}

export interface EpisodeResult {
  episodeId: number;
  trueState: TrueState;
  finalProtocol?: ProtocolLevel;
  payoffs: { a: number; b: number };
  history: string[];
  agentBeliefs: { a: NestedBelief; b: NestedBelief };
  reviewAction?: ReviewAction;
  reputationDeltas?: { a: number; b: number };
}

export interface ABTestMetrics {
  coopRate: number; // % of episodes with secure high/medium agreements
  breachRate: number; // % of episodes with negative payoffs
  avgPayoffA: number;
  avgPayoffB: number;
  totalEpisodes: number;
  reputationEnabled: boolean;
}

export interface LLMResponse {
  action: string;
}

export interface GameConfig {
  maxRounds: number;
  beliefUpdateStrength: {
    proposal: number;
    review: number;
  };
  payoffNoise: number;
  initialBeliefAlignment: number;
}
