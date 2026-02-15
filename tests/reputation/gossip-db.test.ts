import { GossipDatabase } from '../../src/reputation/gossip-db';
import { GossipEntry } from '../../src/types';

function makeEntry(overrides: Partial<GossipEntry> = {}): GossipEntry {
  return {
    complainedName: 'Target',
    complainedId: 10,
    complainedRole: 'trustee',
    gossiperName: 'Gossiper',
    gossiperRole: 'investor',
    gossipInfo: 'did not cooperate',
    credibilityLevel: 'credible',
    shouldSpread: true,
    reasons: 'looks plausible',
    createdAtStep: 1,
    sourceChain: ['Gossiper'],
    ...overrides,
  };
}

describe('GossipDatabase', () => {
  test('stores and returns defensive copies', () => {
    const db = new GossipDatabase();
    db.addEntry(makeEntry());

    const all = db.getAllEntries();
    all[0].sourceChain.push('Mutator');

    expect(db.getAllEntries()[0].sourceChain).toEqual(['Gossiper']);
  });

  test('filters with query and recent window helpers', () => {
    const db = new GossipDatabase();
    db.addEntry(makeEntry({ complainedName: 'Alice', createdAtStep: 2 }));
    db.addEntry(
      makeEntry({
        complainedName: 'Bob',
        gossiperName: 'Carol',
        createdAtStep: 5,
      })
    );

    expect(db.query({ complainedName: 'Alice' })).toHaveLength(1);
    expect(db.query({ gossiperName: 'Carol' })).toHaveLength(1);
    expect(db.query({ minStep: 3, maxStep: 5 })).toHaveLength(1);
    expect(db.getRecentEntries(5, 2)).toHaveLength(1);
    expect(db.getRecentByTarget('Bob', 5, 3)).toHaveLength(1);
  });

  test('exports/imports and clears data', () => {
    const db = new GossipDatabase();
    db.addEntry(makeEntry({ complainedName: 'Alice' }));

    const snapshot = db.export();
    db.clear();
    expect(db.getAllEntries()).toEqual([]);

    db.import(snapshot);
    expect(db.getAllEntries()).toHaveLength(1);
    expect(db.getAllEntries()[0].complainedName).toBe('Alice');
  });
});
