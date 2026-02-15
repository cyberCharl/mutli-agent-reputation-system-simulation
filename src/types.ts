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

// --- RepuNet-compatible extensions (non-breaking) ---

export type AgentRole =
  | 'investor'
  | 'trustee'
  | 'player'
  | 'resident'
  | 'proposer'
  | 'reviewer';

export type CredibilityLevel =
  | 'very_credible'
  | 'credible'
  | 'uncredible'
  | 'very_uncredible';

export interface NumericalRecord {
  investmentFailures: number;
  trusteeFailures: number;
  returnIssues: number;
  returnSuccesses: number;
  investorSuccesses: number;
}

export interface ReputationEntry {
  name: string;
  id: number;
  role: AgentRole;
  content: string;
  numericalRecord: NumericalRecord;
  reason: string;
  updatedAtStep: number;
}

export interface GossipEntry {
  complainedName: string;
  complainedId: number;
  complainedRole: AgentRole;
  gossiperName: string;
  gossiperRole: AgentRole;
  gossipInfo: string;
  credibilityLevel: CredibilityLevel;
  shouldSpread: boolean;
  reasons: string;
  createdAtStep: number;
  sourceChain: string[];
}

export type ScenarioType = 'mspn' | 'investment' | 'pd_game' | 'sign_up';
export type ReputationBackendType = 'karma' | 'repunet' | 'hybrid';

export interface GossipConfig {
  enabled: boolean;
  maxSpreadDepth: number;
  credibilityDecay: number;
  recentWindow: number;
  listenerSelection: 'random' | 'reputation_weighted';
}

export interface NetworkConfig {
  enabled: boolean;
  blackListMaxSize: number;
  observationInterval: number;
  initialConnectivity: number;
}

export interface StorageConfig {
  basePath: string;
  runId: string;
  persistInterval: number;
}

export type AblationMode = 'full' | 'no_gossip' | 'no_reputation' | 'minimal';

export interface SimulationConfig extends GameConfig {
  agentCount: number;
  scenario: ScenarioType;
  reputationBackend: ReputationBackendType;
  enableGossip: boolean;
  gossipConfig: GossipConfig;
  enableNetwork: boolean;
  networkConfig: NetworkConfig;
  storageConfig: StorageConfig;
  ablationMode: AblationMode;
}

export interface ScenarioResult {
  pairId: string;
  agents: [string, string];
  roles: [AgentRole, AgentRole];
  actions: Record<string, string>;
  payoffs: Record<string, number>;
  history: string[];
  metadata: Record<string, unknown>;
}

export interface ScenarioRuntimeContext {
  step: number;
  network: unknown;
  reputationSystem: unknown;
  gossipEngine: unknown | null;
  llm: unknown;
  config: SimulationConfig;
}

export interface ScenarioPlugin {
  name: string;
  roles: AgentRole[];
  pair(
    agents: unknown[],
    network: unknown,
    config: ScenarioConfig
  ): Promise<Array<[unknown, unknown]>>;
  execute(
    pair: [unknown, unknown],
    context: ScenarioRuntimeContext
  ): Promise<ScenarioResult>;
  updateReputation(
    pair: [unknown, unknown],
    result: ScenarioResult,
    context: ScenarioRuntimeContext
  ): Promise<void>;
  shouldTriggerGossip(result: ScenarioResult): boolean;
}

export interface ScenarioConfig {
  maxRounds: number;
  payoffMatrix?: Record<string, [number, number]>;
}

export interface AblationVariant {
  mode: AblationMode;
  enableReputation: boolean;
  enableGossip: boolean;
  reputationBackend: ReputationBackendType;
}
