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

export type CorrectionMethod =
  | 'bonferroni'
  | 'holm'
  | 'benjamini-hochberg'
  | 'none';

export type EffectSizeInterpretation =
  | 'negligible'
  | 'small'
  | 'medium'
  | 'large';

export interface Hypothesis {
  id: string;
  description: string;
  direction: 'two-tailed' | 'greater' | 'less';
  alpha: number;
  correctionGroup?: string;
}

export interface SampleSizePlan {
  targetPower: number;
  expectedEffectSize: number;
  computedMinimum: number;
  plannedTotal: number;
  justification: string;
}

export interface AnalysisPlan {
  primaryTest: 't-test' | 'mann-whitney' | 'bootstrap';
  correctionMethod: CorrectionMethod;
  stratification: string[];
}

export interface ExperimentManifest {
  experimentId: string;
  createdAt: string;
  hypotheses: Hypothesis[];
  primaryMetric: string;
  secondaryMetrics: string[];
  sampleSize: SampleSizePlan;
  analysisPlan: AnalysisPlan;
  scenarios: string[];
  models: string[];
  conditions: string[];
}

export interface PowerAnalysis {
  requiredSampleSize: number;
  achievedPower: number;
  effectSize: number;
  alpha: number;
}

export interface MetricInterval {
  lower: number;
  upper: number;
}

export interface StratifiedMetrics {
  totalEpisodes: number;
  coopRate: number;
  breachRate: number;
  avgPayoff: number;
  totalPayoff: number;
}

export interface ABTestMetrics {
  coopRate: number; // % of episodes with secure high/medium agreements
  breachRate: number; // % of episodes with negative payoffs
  avgPayoffA: number;
  avgPayoffB: number;
  totalEpisodes: number;
  reputationEnabled: boolean;
  byScenario?: Record<string, StratifiedMetrics>;
  byModel?: Record<string, StratifiedMetrics>;
  byRole?: Record<string, StratifiedMetrics>;
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
    correctedPValue: number;
    significant: boolean;
    significantAfterCorrection: boolean;
    meanDifference: number;
    effectSize: number;
    effectSizeInterpretation: EffectSizeInterpretation;
    achievedPower: number;
    sampleSizeAdequate: boolean;
    ci: MetricInterval;
  };
  payoffB: {
    tStatistic: number;
    pValue: number;
    correctedPValue: number;
    significant: boolean;
    significantAfterCorrection: boolean;
    meanDifference: number;
    effectSize: number;
    effectSizeInterpretation: EffectSizeInterpretation;
    achievedPower: number;
    sampleSizeAdequate: boolean;
    ci: MetricInterval;
  };
  totalPayoff: {
    tStatistic: number;
    pValue: number;
    correctedPValue: number;
    significant: boolean;
    significantAfterCorrection: boolean;
    meanDifference: number;
    effectSize: number;
    effectSizeInterpretation: EffectSizeInterpretation;
    achievedPower: number;
    sampleSizeAdequate: boolean;
    ci: MetricInterval;
  };
  baselineCI: { mean: number; lower: number; upper: number };
  treatmentCI: { mean: number; lower: number; upper: number };
  correctionMethod: CorrectionMethod;
  familyWiseErrorRate: number;
  warnings: string[];
}
