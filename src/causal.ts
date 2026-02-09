import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { NestedBelief } from './types';

export interface CausalDecisionRecord {
  // Identity
  traceId: string;
  decisionId: string;
  parentDecisionId?: string;

  // Before (what agent observed)
  informationSet: {
    ownKarma: number;
    opponentKarma: number;
    beliefs: NestedBelief;
    historyVisible: string[];
  };

  // Decision (intervention point)
  action: {
    type: 'propose' | 'review';
    value: string;
    reasoning: string;
    alternatives: string[];
    isForced?: boolean;
  };

  // Outcome (back-filled after episode resolution)
  outcome?: {
    counterpartyAction: string;
    finalProtocol?: string;
    payoff: number;
    expectedPayoff: number;
    surprise: number;
  };

  // After (enables counterfactuals, back-filled)
  beliefUpdate?: {
    karmaDelta: number;
    beliefDelta: Partial<NestedBelief>;
    updateMagnitude: number;
  };
}

export class CausalDecisionLog {
  private records: CausalDecisionRecord[] = [];
  public readonly traceId: string;

  constructor(episodeSeed: string) {
    // Deterministic traceId from episode seed for reproducibility
    this.traceId = crypto
      .createHash('sha256')
      .update(episodeSeed)
      .digest('hex')
      .slice(0, 16);
  }

  generateDecisionId(): string {
    return `${this.traceId}-${this.records.length}`;
  }

  addRecord(record: CausalDecisionRecord): void {
    this.records.push(record);
  }

  getRecords(): ReadonlyArray<CausalDecisionRecord> {
    return this.records;
  }

  getLastRecord(): CausalDecisionRecord | undefined {
    return this.records[this.records.length - 1];
  }

  getRecordsByType(
    type: 'propose' | 'review'
  ): ReadonlyArray<CausalDecisionRecord> {
    return this.records.filter((r) => r.action.type === type);
  }

  backfillOutcome(
    decisionId: string,
    outcome: CausalDecisionRecord['outcome']
  ): void {
    const record = this.records.find((r) => r.decisionId === decisionId);
    if (record) {
      record.outcome = outcome;
    }
  }

  backfillBeliefUpdate(
    decisionId: string,
    beliefUpdate: CausalDecisionRecord['beliefUpdate']
  ): void {
    const record = this.records.find((r) => r.decisionId === decisionId);
    if (record) {
      record.beliefUpdate = beliefUpdate;
    }
  }

  toNDJSON(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  saveToFile(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, this.toNDJSON());
  }

  appendToFile(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, this.toNDJSON());
  }
}
