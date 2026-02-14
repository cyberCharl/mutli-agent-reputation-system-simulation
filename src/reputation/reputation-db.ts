/**
 * ReputationDatabase — Ported from RepuNet's reputation/reputation_database.py
 *
 * Per-agent reputation database storing assessments of other agents.
 * Implements the ReputationBackend interface with 5-tuple numerical records.
 */

import {
  NumericalRecord,
  ReputationEntry,
  ReputationBackend,
} from '../types';

/** Create a zero-initialized numerical record */
export function createNumericalRecord(): NumericalRecord {
  return {
    investmentFailures: 0,
    trusteeFailures: 0,
    returnIssues: 0,
    returnSuccesses: 0,
    investorSuccesses: 0,
  };
}

/**
 * Aggregate reputation score from 5-tuple.
 * Formula: score = investorSuccesses + returnSuccesses - trusteeFailures - investmentFailures
 * Clamped to [-1, 1].
 */
export function computeAggregateScore(record: NumericalRecord): number {
  const raw =
    record.investorSuccesses +
    record.returnSuccesses -
    record.trusteeFailures -
    record.investmentFailures;
  return Math.max(-1, Math.min(1, raw));
}

/**
 * ReputationDatabase — stores one agent's view of all other agents' reputations.
 * Keyed by `${targetId}:${role}` for role-specific reputation tracking.
 */
export class ReputationDatabase implements ReputationBackend {
  private ownerId: string;
  private current: Map<string, ReputationEntry> = new Map();
  private outOfDate: Map<string, ReputationEntry[]> = new Map();

  constructor(ownerId: string) {
    this.ownerId = ownerId;
  }

  private key(targetId: string, role: string): string {
    return `${targetId}:${role}`;
  }

  getReputation(
    _agentId: string,
    targetId: string,
    role: string
  ): ReputationEntry | null {
    return this.current.get(this.key(targetId, role)) ?? null;
  }

  updateReputation(_agentId: string, entry: ReputationEntry): void {
    const k = this.key(String(entry.id), entry.role);

    // Archive current entry before replacing
    const existing = this.current.get(k);
    if (existing) {
      const history = this.outOfDate.get(k) || [];
      history.push(existing);
      this.outOfDate.set(k, history);
    }

    this.current.set(k, { ...entry });
  }

  getAllReputations(_agentId: string, role: string): ReputationEntry[] {
    const results: ReputationEntry[] = [];
    for (const [k, entry] of this.current) {
      if (k.endsWith(`:${role}`)) {
        results.push(entry);
      }
    }
    return results;
  }

  getAggregateScore(_agentId: string, role: string): number {
    const reputations = this.getAllReputations(_agentId, role);
    if (reputations.length === 0) return 0;

    const total = reputations.reduce(
      (sum, r) => sum + computeAggregateScore(r.numericalRecord),
      0
    );
    return total / reputations.length;
  }

  /** Get reputation of a specific target by numeric ID and role */
  getTargetReputation(
    targetId: number,
    role: string
  ): ReputationEntry | null {
    return this.current.get(this.key(String(targetId), role)) ?? null;
  }

  /** Get historical (out-of-date) reputations for a target */
  getReputationHistory(
    targetId: number,
    role: string
  ): ReputationEntry[] {
    return this.outOfDate.get(this.key(String(targetId), role)) || [];
  }

  /** Get all current entries (any role) excluding self */
  getAllCurrentEntries(): ReputationEntry[] {
    return Array.from(this.current.values()).filter(
      (e) => String(e.id) !== this.ownerId
    );
  }

  /** Owner ID getter */
  getOwnerId(): string {
    return this.ownerId;
  }

  export(): Record<string, unknown> {
    const current: Record<string, unknown> = {};
    for (const [k, v] of this.current) {
      current[k] = v;
    }
    const history: Record<string, unknown[]> = {};
    for (const [k, v] of this.outOfDate) {
      history[k] = v;
    }
    return { ownerId: this.ownerId, current, history };
  }

  import(data: Record<string, unknown>): void {
    this.current.clear();
    this.outOfDate.clear();

    const current = data.current as Record<string, ReputationEntry> | undefined;
    if (current) {
      for (const [k, v] of Object.entries(current)) {
        this.current.set(k, v);
      }
    }

    const history = data.history as Record<string, ReputationEntry[]> | undefined;
    if (history) {
      for (const [k, v] of Object.entries(history)) {
        this.outOfDate.set(k, v);
      }
    }
  }
}
