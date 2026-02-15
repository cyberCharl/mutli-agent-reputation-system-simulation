import { AgentRole, NumericalRecord, ReputationEntry } from '../types';

export interface ReputationStats {
  totalEntries: number;
  averageScore: number;
  scoreDistribution: number[];
}

export interface ReputationBackend {
  getReputation(
    agentId: string,
    targetId: string,
    role?: AgentRole
  ): ReputationEntry | null;
  updateReputation(agentId: string, entry: ReputationEntry): void;
  getAllReputations(agentId: string, role?: AgentRole): ReputationEntry[];
  getAggregateScore(agentId: string, targetId: string): number;
  export(): Record<string, unknown>;
  import(data: Record<string, unknown>): void;
  getStats(): ReputationStats;
}

export interface RepuNetBackend extends ReputationBackend {
  getNumericalRecord(agentId: string, targetId: string): NumericalRecord;
  getHistoricalReputations(
    agentId: string,
    targetId: string
  ): ReputationEntry[];
}
