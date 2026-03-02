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
  roundCount: number;
  converged: boolean;
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

export interface StatisticalSignificance {
  payoffA: {
    tStatistic: number;
    pValue: number;
    significant: boolean;
    meanDifference: number;
  };
  payoffB: {
    tStatistic: number;
    pValue: number;
    significant: boolean;
    meanDifference: number;
  };
  baselineCI: { mean: number; lower: number; upper: number };
  treatmentCI: { mean: number; lower: number; upper: number };
}

export type TraceVariant = 'baseline' | 'reputation' | 'adhoc';

export type TraceActionType = 'propose' | 'review';

export type TraceEventType =
  | 'episode_started'
  | 'agent_prompted'
  | 'agent_acted'
  | 'action_constrained'
  | 'belief_updated'
  | 'evaluator_scored'
  | 'reputation_updated'
  | 'episode_finished';

export type TraceAction = ProtocolLevel | ReviewAction;

export interface EpisodeStartedPayload {
  variant: TraceVariant;
  trueState: TrueState;
  reputationEnabled: boolean;
  seed?: string;
  initialKarma: Record<AgentId, number>;
}

export interface AgentPromptedPayload {
  round: number;
  actionType: TraceActionType;
  modelId: string;
  prompt: string;
  history: string[];
  belief: NestedBelief;
  karma: number;
  opponentKarma?: number;
  reputationWarning?: string;
  proposal?: ProtocolLevel;
}

export interface AgentActedPayload {
  round: number;
  actionType: TraceActionType;
  modelId: string;
  promptEventId?: string;
  chosenAction: TraceAction;
  outputText: string;
  source: 'mock' | 'llm' | 'fallback';
  error?: string;
}

export interface ActionConstrainedPayload {
  round: number;
  actionType: TraceActionType;
  originalAction: TraceAction;
  appliedAction: TraceAction;
  wasConstrained: boolean;
  reason: 'none' | 'blocked_action' | 'auto_reject';
  blockedActions: ProtocolLevel[];
  payoffPenalty: number;
  autoReject: boolean;
  karma: number;
}

export interface BeliefUpdatedPayload {
  round: number;
  phase: 'proposal' | 'review';
  updateKind: 'self' | 'observation';
  sourceAgentId: AgentId;
  subjectAgentId: AgentId;
  targetField: 'own' | 'aboutOpponent';
  basisAction: TraceAction;
  before: Record<TrueState, number>;
  after: Record<TrueState, number>;
}

export interface EvaluatorScoredPayload {
  sourceEvaluator: string;
  rubricVersion: string;
  targetModelId: string;
  targetAgentId: AgentId;
  delta: number;
  reason: string;
  outcome: {
    trueState: TrueState;
    finalProtocol?: ProtocolLevel;
    reviewAction?: ReviewAction;
    payoffs: { a: number; b: number };
  };
}

export interface ReputationUpdatedPayload {
  sourceEvaluator: string;
  rubricVersion: string;
  targetModelId: string;
  targetAgentId: AgentId;
  previousKarma: number;
  newKarma: number;
  delta: number;
  reason: string;
}

export interface EpisodeFinishedPayload {
  roundCount: number;
  converged: boolean;
  trueState: TrueState;
  finalProtocol?: ProtocolLevel;
  reviewAction?: ReviewAction;
  payoffs: { a: number; b: number };
  rawPayoffs?: { a: number; b: number };
}

export interface TraceEventPayloadMap {
  episode_started: EpisodeStartedPayload;
  agent_prompted: AgentPromptedPayload;
  agent_acted: AgentActedPayload;
  action_constrained: ActionConstrainedPayload;
  belief_updated: BeliefUpdatedPayload;
  evaluator_scored: EvaluatorScoredPayload;
  reputation_updated: ReputationUpdatedPayload;
  episode_finished: EpisodeFinishedPayload;
}

export interface TraceEventBase {
  eventId: string;
  runId: string;
  episodeId: string;
  turnId?: string;
  agentId?: string;
  parentSpanId?: string;
  causeEventIds?: string[];
  timestamp: string;
}

export type TraceEvent = {
  [K in TraceEventType]: TraceEventBase & {
    eventType: K;
    payload: TraceEventPayloadMap[K];
  };
}[TraceEventType];

export interface TraceEpisodeSummary {
  runId: string;
  episodeId: string;
  episodeNumber: number;
  variant: TraceVariant;
  reputationEnabled: boolean;
  eventCount: number;
  trueState: TrueState;
  finalProtocol?: ProtocolLevel;
  reviewAction?: ReviewAction;
  payoffs: { a: number; b: number };
  history: string[];
  roundCount: number;
  converged: boolean;
  reputationDeltas?: { a: number; b: number };
  traceFile: string;
  summaryFile: string;
}
