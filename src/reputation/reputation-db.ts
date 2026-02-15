import { AgentRole, NumericalRecord, ReputationEntry } from '../types';
import { RepuNetBackend, ReputationStats } from './reputation-backend';

type ObserverMap = Map<string, Map<string, ReputationEntry>>;
type HistoryMap = Map<string, Map<string, ReputationEntry[]>>;

export function emptyNumericalRecord(): NumericalRecord {
  return {
    investmentFailures: 0,
    trusteeFailures: 0,
    returnIssues: 0,
    returnSuccesses: 0,
    investorSuccesses: 0,
  };
}

export class ReputationDatabase implements RepuNetBackend {
  private readonly current: ObserverMap = new Map();
  private readonly historical: HistoryMap = new Map();

  getReputation(
    agentId: string,
    targetId: string,
    role?: AgentRole
  ): ReputationEntry | null {
    const byObserver = this.current.get(agentId);
    if (!byObserver) {
      return null;
    }
    const direct = byObserver.get(this.makeTargetKey(targetId, role));
    if (direct) {
      return direct;
    }
    if (role) {
      return null;
    }
    for (const [key, value] of byObserver.entries()) {
      if (key.startsWith(`${targetId}:`)) {
        return value;
      }
    }
    return null;
  }

  updateReputation(agentId: string, entry: ReputationEntry): void {
    const targetKey = this.makeTargetKey(String(entry.id), entry.role);
    const observerMap =
      this.current.get(agentId) ?? new Map<string, ReputationEntry>();
    const previous = observerMap.get(targetKey);

    if (previous) {
      const observerHistory =
        this.historical.get(agentId) ?? new Map<string, ReputationEntry[]>();
      const targetHistory = observerHistory.get(targetKey) ?? [];
      targetHistory.push(previous);
      observerHistory.set(targetKey, targetHistory);
      this.historical.set(agentId, observerHistory);
    }

    observerMap.set(targetKey, { ...entry });
    this.current.set(agentId, observerMap);
  }

  getAllReputations(agentId: string, role?: AgentRole): ReputationEntry[] {
    const observerMap = this.current.get(agentId);
    if (!observerMap) {
      return [];
    }
    const entries = Array.from(observerMap.values());
    if (!role) {
      return entries;
    }
    return entries.filter((entry) => entry.role === role);
  }

  getAggregateScore(agentId: string, targetId: string): number {
    const records = this.getAllReputations(agentId).filter(
      (entry) => String(entry.id) === targetId
    );
    if (records.length === 0) {
      return 0;
    }

    const totals = records.reduce(
      (acc, entry) => {
        const record = entry.numericalRecord;
        acc.positive += record.investorSuccesses + record.returnSuccesses;
        acc.negative +=
          record.investmentFailures +
          record.trusteeFailures +
          record.returnIssues;
        return acc;
      },
      { positive: 0, negative: 0 }
    );

    const denom = Math.max(1, totals.positive + totals.negative);
    return this.clamp((totals.positive - totals.negative) / denom);
  }

  getNumericalRecord(agentId: string, targetId: string): NumericalRecord {
    const records = this.getAllReputations(agentId).filter(
      (entry) => String(entry.id) === targetId
    );
    if (records.length === 0) {
      return emptyNumericalRecord();
    }

    return records.reduce<NumericalRecord>((acc, entry) => {
      const next = entry.numericalRecord;
      acc.investmentFailures += next.investmentFailures;
      acc.trusteeFailures += next.trusteeFailures;
      acc.returnIssues += next.returnIssues;
      acc.returnSuccesses += next.returnSuccesses;
      acc.investorSuccesses += next.investorSuccesses;
      return acc;
    }, emptyNumericalRecord());
  }

  getHistoricalReputations(
    agentId: string,
    targetId: string
  ): ReputationEntry[] {
    const observerHistory = this.historical.get(agentId);
    if (!observerHistory) {
      return [];
    }

    const matches: ReputationEntry[] = [];
    for (const [key, entries] of observerHistory.entries()) {
      if (key.startsWith(`${targetId}:`)) {
        matches.push(...entries);
      }
    }
    return matches;
  }

  export(): Record<string, unknown> {
    const current: Record<string, Record<string, ReputationEntry>> = {};
    const historical: Record<string, Record<string, ReputationEntry[]>> = {};

    for (const [observer, targetMap] of this.current.entries()) {
      current[observer] = Object.fromEntries(targetMap.entries());
    }
    for (const [observer, targetMap] of this.historical.entries()) {
      historical[observer] = Object.fromEntries(targetMap.entries());
    }

    return {
      current,
      historical,
    };
  }

  import(data: Record<string, unknown>): void {
    this.current.clear();
    this.historical.clear();

    const current = data.current as Record<
      string,
      Record<string, ReputationEntry>
    >;
    const historical = data.historical as Record<
      string,
      Record<string, ReputationEntry[]>
    >;

    if (current && typeof current === 'object') {
      for (const [observer, targetRecord] of Object.entries(current)) {
        this.current.set(
          observer,
          new Map<string, ReputationEntry>(Object.entries(targetRecord))
        );
      }
    }

    if (historical && typeof historical === 'object') {
      for (const [observer, targetRecord] of Object.entries(historical)) {
        this.historical.set(
          observer,
          new Map<string, ReputationEntry[]>(Object.entries(targetRecord))
        );
      }
    }
  }

  getStats(): ReputationStats {
    const scores: number[] = [];
    let totalEntries = 0;

    for (const [observer, targetMap] of this.current.entries()) {
      totalEntries += targetMap.size;
      const uniqueTargets = new Set<string>();
      for (const key of targetMap.keys()) {
        uniqueTargets.add(key.split(':')[0]);
      }
      for (const targetId of uniqueTargets) {
        scores.push(this.getAggregateScore(observer, targetId));
      }
    }

    const averageScore =
      scores.length === 0
        ? 0
        : scores.reduce((sum, score) => sum + score, 0) / scores.length;

    return {
      totalEntries,
      averageScore,
      scoreDistribution: scores,
    };
  }

  private makeTargetKey(targetId: string, role?: AgentRole): string {
    return `${targetId}:${role ?? 'any'}`;
  }

  private clamp(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }
}
