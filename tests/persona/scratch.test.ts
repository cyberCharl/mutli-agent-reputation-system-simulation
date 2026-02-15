import { createAgentState } from '../../src/persona/scratch';

describe('createAgentState', () => {
  test('creates a fully initialized state with defaults', () => {
    const state = createAgentState({
      name: 'Alice',
      id: 1,
    });

    expect(state.name).toBe('Alice');
    expect(state.id).toBe(1);
    expect(state.role).toBeNull();
    expect(state.currentStep).toBe(0);
    expect(state.innate).toBeNull();
    expect(state.resourcesUnit).toBe(10);
    expect(state.complainBuffer).toEqual([]);
    expect(state.observed).toEqual([]);

    expect(state.learned).toEqual({
      investor: '',
      trustee: '',
      player: '',
      resident: '',
      proposer: '',
      reviewer: '',
    });

    expect(state.roleCounters).toEqual({
      investor: { total: 0, success: 0 },
      trustee: { total: 0, success: 0 },
      player: { total: 0, success: 0 },
      resident: { total: 0, success: 0 },
      proposer: { total: 0, success: 0 },
      reviewer: { total: 0, success: 0 },
    });

    expect(state.relationship).toEqual({
      bindList: [],
      blackList: [],
    });
  });

  test('uses provided optional fields', () => {
    const state = createAgentState({
      name: 'Bob',
      id: 2,
      role: 'trustee',
      innate: 'cooperative bias',
      resourcesUnit: 42,
    });

    expect(state.role).toBe('trustee');
    expect(state.innate).toBe('cooperative bias');
    expect(state.resourcesUnit).toBe(42);
  });

  test('returns isolated mutable containers per state instance', () => {
    const a = createAgentState({ name: 'A', id: 1 });
    const b = createAgentState({ name: 'B', id: 2 });

    a.complainBuffer.push('x');
    a.relationship.blackList.push('blocked');
    a.roleCounters.investor.total += 1;
    a.learned.trustee = 'updated';

    expect(b.complainBuffer).toEqual([]);
    expect(b.relationship.blackList).toEqual([]);
    expect(b.roleCounters.investor.total).toBe(0);
    expect(b.learned.trustee).toBe('');
  });
});
