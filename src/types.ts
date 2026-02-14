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
  decisionLog?: import('./causal').CausalDecisionLog;
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

// ===== RepuNet Integration Types =====

/** 5-tuple numerical record for reputation tracking */
export interface NumericalRecord {
  investmentFailures: number;
  trusteeFailures: number;
  returnIssues: number;
  returnSuccesses: number;
  investorSuccesses: number;
}

/** A single reputation entry an agent holds about another agent */
export interface ReputationEntry {
  name: string;
  id: number;
  role: string;
  content: string;
  numericalRecord: NumericalRecord;
  reason: string;
  updatedAtStep: number;
}

export type CredibilityLevel =
  | 'very_credible'
  | 'credible'
  | 'uncredible'
  | 'very_uncredible';

/** A gossip entry heard about another agent */
export interface GossipEntry {
  complainedName: string;
  complainedId: number;
  complainedRole: string;
  gossiperRole: string;
  gossipInfo: string;
  credibilityLevel: CredibilityLevel;
  shouldSpread: boolean;
  reasons: string;
  createdAtStep: number;
}

/** Mutable per-step agent state (ported from RepuNet Scratch) */
export interface AgentState {
  name: string;
  id: number;
  role: string | null;
  currentStep: number;
  learned: Record<string, string>;
  complainBuffer: string[];
  successCounts: Record<string, { total: number; success: number }>;
  relationship: {
    bindList: Array<[string, string]>;
    blackList: string[];
  };
  resourcesUnit: number;
  observed: Record<string, unknown>;
}

/** Memory node types (ported from RepuNet AssociativeMemory) */
export interface MemoryNode {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  description: string;
  createdAt: number;
}

export interface ChatNode extends MemoryNode {
  conversation: string;
}

export interface EventNode extends MemoryNode {
  eventType: string;
}

/** Social network interface */
export interface SocialNetworkInterface {
  addEdge(from: string, to: string, role: string): void;
  removeEdge(from: string, to: string, role: string): void;
  hasEdge(from: string, to: string, role: string): boolean;
  getConnections(agentId: string, role: string): string[];
  getBlackList(agentId: string): string[];
  addToBlackList(agentId: string, target: string): void;
  toJSON(): Record<string, unknown>;
}

/** Scenario plugin interface */
export interface ScenarioResult {
  payoffs: Record<string, number>;
  actions: Record<string, string>;
  history: string[];
  metadata: Record<string, unknown>;
}

/** Pluggable reputation backend interface */
export interface ReputationBackend {
  getReputation(
    agentId: string,
    targetId: string,
    role: string
  ): ReputationEntry | null;
  updateReputation(agentId: string, entry: ReputationEntry): void;
  getAllReputations(agentId: string, role: string): ReputationEntry[];
  getAggregateScore(agentId: string, role: string): number;
  export(): Record<string, unknown>;
  import(data: Record<string, unknown>): void;
}

/** Extended simulation config with RepuNet options */
export interface RepuNetConfig {
  agentCount: number;
  scenario: 'mspn' | 'investment' | 'pd_game' | 'sign_up';
  enableGossip: boolean;
  enableNetwork: boolean;
  reputationBackend: 'karma' | 'repunet' | 'hybrid';
  gossipConfig: {
    maxSpreadDepth: number;
    credibilityDecay: number;
    recentWindow: number;
  };
  networkConfig: {
    blackListMaxSize: number;
    observationInterval: number;
  };
}

export const DEFAULT_REPUNET_CONFIG: RepuNetConfig = {
  agentCount: 20,
  scenario: 'mspn',
  enableGossip: false,
  enableNetwork: false,
  reputationBackend: 'karma',
  gossipConfig: {
    maxSpreadDepth: 2,
    credibilityDecay: 0.3,
    recentWindow: 30,
  },
  networkConfig: {
    blackListMaxSize: 5,
    observationInterval: 5,
  },
};
