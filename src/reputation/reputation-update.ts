import { AgentRole, NumericalRecord, ReputationEntry } from '../types';
import { ReputationDatabase, emptyNumericalRecord } from './reputation-db';

export interface ReputationDeltaApplication {
  observerId: string;
  target: {
    id: string;
    name: string;
    role: AgentRole;
  };
  delta: Partial<NumericalRecord>;
  narrative: string;
  reason: string;
  step: number;
}

export class ReputationUpdater {
  constructor(private readonly reputationDb: ReputationDatabase) {}

  applyDelta(input: ReputationDeltaApplication): ReputationEntry {
    const current = this.reputationDb.getReputation(
      input.observerId,
      input.target.id,
      input.target.role
    );

    const base = current?.numericalRecord ?? emptyNumericalRecord();
    const next = this.mergeRecord(base, input.delta);

    const nextEntry: ReputationEntry = {
      name: input.target.name,
      id: Number(input.target.id),
      role: input.target.role,
      content: input.narrative,
      numericalRecord: next,
      reason: input.reason,
      updatedAtStep: input.step,
    };

    this.reputationDb.updateReputation(input.observerId, nextEntry);
    return nextEntry;
  }

  applyBatch(updates: ReputationDeltaApplication[]): ReputationEntry[] {
    return updates.map((update) => this.applyDelta(update));
  }

  private mergeRecord(
    base: NumericalRecord,
    delta: Partial<NumericalRecord>
  ): NumericalRecord {
    return {
      investmentFailures:
        base.investmentFailures + (delta.investmentFailures ?? 0),
      trusteeFailures: base.trusteeFailures + (delta.trusteeFailures ?? 0),
      returnIssues: base.returnIssues + (delta.returnIssues ?? 0),
      returnSuccesses: base.returnSuccesses + (delta.returnSuccesses ?? 0),
      investorSuccesses:
        base.investorSuccesses + (delta.investorSuccesses ?? 0),
    };
  }
}
