/**
 * GossipDatabase — Ported from RepuNet's reputation/gossip_database.py
 *
 * Stores gossip heard about other agents with credibility assessment.
 * Supports recency windowing and credibility counter tracking.
 */

import { GossipEntry, CredibilityLevel } from '../types';

const DEFAULT_RECENT_WINDOW = 30;

/** Credibility counter weights for aggregate evaluation */
const CREDIBILITY_WEIGHTS: Record<CredibilityLevel, number> = {
  very_credible: 2,
  credible: 1,
  uncredible: -1,
  very_uncredible: -2,
};

export class GossipDatabase {
  private ownerId: string;
  private entries: GossipEntry[] = [];
  private credibilityCounts: Map<
    string,
    Record<CredibilityLevel, number>
  > = new Map();

  constructor(ownerId: string) {
    this.ownerId = ownerId;
  }

  /** Add gossip entries and update credibility counters */
  addGossip(gossips: GossipEntry[], currentStep: number): void {
    for (const gossip of gossips) {
      const entry = { ...gossip, createdAtStep: currentStep };
      this.entries.push(entry);

      // Update credibility counter for this target
      const key = `${entry.complainedId}:${entry.complainedRole}`;
      const counts = this.credibilityCounts.get(key) || {
        very_credible: 0,
        credible: 0,
        uncredible: 0,
        very_uncredible: 0,
      };
      counts[entry.credibilityLevel] += 1;
      this.credibilityCounts.set(key, counts);
    }
  }

  /** Get recent gossip about a target (within recency window) */
  getTargetGossip(
    targetId: number,
    targetRole: string,
    currentStep: number,
    recentWindow: number = DEFAULT_RECENT_WINDOW
  ): GossipEntry[] {
    const cutoff = currentStep - recentWindow;
    return this.entries.filter(
      (e) =>
        e.complainedId === targetId &&
        e.complainedRole === targetRole &&
        e.createdAtStep >= cutoff
    );
  }

  /** Get all gossip about a target (any recency) */
  getAllTargetGossip(targetId: number, role: string): GossipEntry[] {
    return this.entries.filter(
      (e) => e.complainedId === targetId && e.complainedRole === role
    );
  }

  /** Get gossip marked for spreading (second-order) */
  getSpreadableGossip(currentStep: number, recentWindow: number = DEFAULT_RECENT_WINDOW): GossipEntry[] {
    const cutoff = currentStep - recentWindow;
    return this.entries.filter(
      (e) => e.shouldSpread && e.createdAtStep >= cutoff
    );
  }

  /** Get credibility score for a target (weighted sum of credibility counts) */
  getCredibilityScore(targetId: number, role: string): number {
    const key = `${targetId}:${role}`;
    const counts = this.credibilityCounts.get(key);
    if (!counts) return 0;

    return Object.entries(counts).reduce(
      (sum, [level, count]) =>
        sum + CREDIBILITY_WEIGHTS[level as CredibilityLevel] * count,
      0
    );
  }

  /** Get total gossip count for this agent */
  size(): number {
    return this.entries.length;
  }

  /** Get owner ID */
  getOwnerId(): string {
    return this.ownerId;
  }

  /** Serialize to JSON */
  toJSON(): Record<string, unknown> {
    const counts: Record<string, Record<CredibilityLevel, number>> = {};
    for (const [k, v] of this.credibilityCounts) {
      counts[k] = v;
    }
    return {
      ownerId: this.ownerId,
      entries: this.entries,
      credibilityCounts: counts,
    };
  }

  /** Load from serialized data */
  static fromJSON(data: Record<string, unknown>): GossipDatabase {
    const db = new GossipDatabase(data.ownerId as string);
    db.entries = (data.entries as GossipEntry[]) || [];
    const counts = data.credibilityCounts as Record<
      string,
      Record<CredibilityLevel, number>
    >;
    if (counts) {
      for (const [k, v] of Object.entries(counts)) {
        db.credibilityCounts.set(k, v);
      }
    }
    return db;
  }
}
