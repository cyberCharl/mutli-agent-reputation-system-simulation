import { GossipDatabase } from '../../src/reputation/gossip-db';
import {
  GossipAgent,
  GossipEngine,
  GossipEvaluationResult,
} from '../../src/reputation/gossip';
import { ReputationDatabase } from '../../src/reputation/reputation-db';
import { GossipConfig } from '../../src/types';

function makeRng(sequence: number[]): () => number {
  let idx = 0;
  return () => {
    const value = sequence[idx] ?? sequence[sequence.length - 1] ?? 0;
    idx += 1;
    return value;
  };
}

const baseConfig: GossipConfig = {
  enabled: true,
  maxSpreadDepth: 3,
  credibilityDecay: 0.2,
  recentWindow: 5,
  listenerSelection: 'random',
};

const gossiper: GossipAgent = { id: '1', name: 'Alice', role: 'investor' };
const target: GossipAgent = { id: '2', name: 'Bob', role: 'trustee' };
const l1: GossipAgent = { id: '3', name: 'Carol', role: 'player' };
const l2: GossipAgent = { id: '4', name: 'Dan', role: 'resident' };
const l3: GossipAgent = { id: '5', name: 'Eve', role: 'reviewer' };

describe('GossipEngine', () => {
  test('returns null when gossip is disabled', async () => {
    const db = new GossipDatabase();
    const repDb = new ReputationDatabase();
    const evaluate = jest.fn<Promise<GossipEvaluationResult>, [any]>();

    const engine = new GossipEngine(
      { ...baseConfig, enabled: false },
      db,
      repDb,
      { evaluateCredibility: evaluate, rng: makeRng([0]) }
    );

    const result = await engine.firstOrderGossip({
      gossiper,
      target,
      grievance: 'bad behavior',
      candidateListeners: [gossiper, target, l1],
      step: 1,
    });

    expect(result).toBeNull();
    expect(db.getAllEntries()).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
  });

  test('uses deterministic random listener and applies reputation update', async () => {
    const db = new GossipDatabase();
    const repDb = new ReputationDatabase();

    const evaluate = jest.fn(
      async (): Promise<GossipEvaluationResult> => ({
        credibilityLevel: 'credible',
        shouldSpread: false,
        reasoning: 'deterministic evaluator',
        reputationAdjustment: 1,
      })
    );

    const hook = jest.fn();

    const engine = new GossipEngine(baseConfig, db, repDb, {
      evaluateCredibility: evaluate,
      onReputationUpdate: hook,
      rng: makeRng([0]),
    });

    const entry = await engine.firstOrderGossip({
      gossiper,
      target,
      grievance: 'did not return investment',
      candidateListeners: [gossiper, target, l1, l2],
      step: 3,
    });

    expect(entry).not.toBeNull();
    expect(db.getAllEntries()).toHaveLength(1);
    expect(db.getAllEntries()[0].sourceChain).toEqual(['Alice']);
    expect(evaluate).toHaveBeenCalledTimes(1);

    const repForListener = repDb.getReputation(l1.id, target.id, target.role);
    expect(repForListener?.numericalRecord.returnSuccesses).toBe(1);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  test('spreads across depths with deterministic evaluator responses', async () => {
    const db = new GossipDatabase();
    const repDb = new ReputationDatabase();

    const evaluate = jest
      .fn()
      .mockImplementationOnce(async () => ({
        credibilityLevel: 'very_credible',
        shouldSpread: true,
        reasoning: 'depth1',
        reputationAdjustment: 1,
      }))
      .mockImplementationOnce(async () => ({
        credibilityLevel: 'credible',
        shouldSpread: true,
        reasoning: 'depth2',
        reputationAdjustment: 0.5,
      }))
      .mockImplementationOnce(async () => ({
        credibilityLevel: 'uncredible',
        shouldSpread: false,
        reasoning: 'depth3',
        reputationAdjustment: -1,
      }));

    const engine = new GossipEngine(baseConfig, db, repDb, {
      evaluateCredibility: evaluate,
      rng: makeRng([0, 0, 0]),
    });

    await engine.firstOrderGossip({
      gossiper,
      target,
      grievance: 'spread test',
      candidateListeners: [gossiper, target, l1, l2, l3],
      step: 8,
    });

    const entries = db.getAllEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0].sourceChain).toEqual(['Alice']);
    expect(entries[1].sourceChain).toEqual(['Alice', 'Carol']);
    expect(entries[2].sourceChain).toEqual(['Alice', 'Carol', 'Dan']);

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate.mock.calls[1][0].depth).toBe(2);
    expect(evaluate.mock.calls[2][0].depth).toBe(3);
  });

  test('supports deterministic reputation-weighted listener selection', async () => {
    const db = new GossipDatabase();
    const repDb = new ReputationDatabase();

    repDb.updateReputation(gossiper.id, {
      name: l1.name,
      id: Number(l1.id),
      role: l1.role,
      content: 'negative trust',
      numericalRecord: {
        investmentFailures: 2,
        trusteeFailures: 0,
        returnIssues: 0,
        returnSuccesses: 0,
        investorSuccesses: 0,
      },
      reason: 'seed',
      updatedAtStep: 1,
    });
    repDb.updateReputation(gossiper.id, {
      name: l2.name,
      id: Number(l2.id),
      role: l2.role,
      content: 'high trust',
      numericalRecord: {
        investmentFailures: 0,
        trusteeFailures: 0,
        returnIssues: 0,
        returnSuccesses: 3,
        investorSuccesses: 0,
      },
      reason: 'seed',
      updatedAtStep: 1,
    });

    const evaluate = jest.fn(
      async (): Promise<GossipEvaluationResult> => ({
        credibilityLevel: 'credible',
        shouldSpread: false,
        reasoning: 'weighted',
        reputationAdjustment: 1,
      })
    );

    const engine = new GossipEngine(
      { ...baseConfig, listenerSelection: 'reputation_weighted' },
      db,
      repDb,
      {
        evaluateCredibility: evaluate,
        rng: makeRng([0.99]),
      }
    );

    await engine.firstOrderGossip({
      gossiper,
      target,
      grievance: 'weighted selection',
      candidateListeners: [gossiper, target, l1, l2],
      step: 10,
    });

    expect(repDb.getReputation(l1.id, target.id, target.role)).toBeNull();
    expect(repDb.getReputation(l2.id, target.id, target.role)).not.toBeNull();
  });
});
