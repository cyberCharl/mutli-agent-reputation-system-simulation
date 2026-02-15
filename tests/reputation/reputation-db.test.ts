import {
  emptyNumericalRecord,
  ReputationDatabase,
} from '../../src/reputation/reputation-db';
import { ReputationEntry } from '../../src/types';

function makeEntry(overrides: Partial<ReputationEntry> = {}): ReputationEntry {
  return {
    name: 'Bob',
    id: 2,
    role: 'trustee',
    content: 'base reputation',
    numericalRecord: {
      investmentFailures: 0,
      trusteeFailures: 0,
      returnIssues: 0,
      returnSuccesses: 0,
      investorSuccesses: 0,
    },
    reason: 'seed',
    updatedAtStep: 1,
    ...overrides,
  };
}

describe('ReputationDatabase', () => {
  test('stores and retrieves reputation with role-aware keys', () => {
    const db = new ReputationDatabase();
    const observer = '1';

    db.updateReputation(
      observer,
      makeEntry({ role: 'trustee', content: 'as trustee' })
    );
    db.updateReputation(
      observer,
      makeEntry({ role: 'investor', content: 'as investor' })
    );

    expect(db.getReputation(observer, '2', 'trustee')?.content).toBe(
      'as trustee'
    );
    expect(db.getReputation(observer, '2', 'investor')?.content).toBe(
      'as investor'
    );
    expect(db.getAllReputations(observer, 'investor')).toHaveLength(1);
    expect(db.getAllReputations(observer)).toHaveLength(2);
  });

  test('keeps historical snapshots when overwriting same target/role', () => {
    const db = new ReputationDatabase();
    const observer = '1';

    db.updateReputation(
      observer,
      makeEntry({ content: 'v1', updatedAtStep: 1 })
    );
    db.updateReputation(
      observer,
      makeEntry({ content: 'v2', updatedAtStep: 2 })
    );

    const history = db.getHistoricalReputations(observer, '2');
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('v1');
    expect(db.getReputation(observer, '2', 'trustee')?.content).toBe('v2');
  });

  test('computes aggregate score and combined numerical record', () => {
    const db = new ReputationDatabase();
    const observer = '1';

    db.updateReputation(
      observer,
      makeEntry({
        role: 'trustee',
        numericalRecord: {
          ...emptyNumericalRecord(),
          returnSuccesses: 2,
          returnIssues: 1,
        },
      })
    );

    db.updateReputation(
      observer,
      makeEntry({
        role: 'investor',
        numericalRecord: {
          ...emptyNumericalRecord(),
          investorSuccesses: 1,
          investmentFailures: 2,
        },
      })
    );

    const record = db.getNumericalRecord(observer, '2');
    expect(record).toEqual({
      investmentFailures: 2,
      trusteeFailures: 0,
      returnIssues: 1,
      returnSuccesses: 2,
      investorSuccesses: 1,
    });

    expect(db.getAggregateScore(observer, '2')).toBe(0);
  });

  test('exports/imports state and reports stats', () => {
    const db = new ReputationDatabase();
    db.updateReputation('1', makeEntry({ id: 2, role: 'trustee' }));
    db.updateReputation('1', makeEntry({ id: 2, role: 'investor' }));
    db.updateReputation('2', makeEntry({ id: 1, role: 'trustee' }));

    const snapshot = db.export();

    const restored = new ReputationDatabase();
    restored.import(snapshot);

    expect(restored.getAllReputations('1')).toHaveLength(2);
    expect(restored.getAllReputations('2')).toHaveLength(1);

    const stats = restored.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.scoreDistribution).toHaveLength(2);
  });
});
