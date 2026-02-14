/**
 * RepuNet Integration Tests — Covers all new modules:
 * - AgentState (persona/scratch.ts)
 * - AssociativeMemory (persona/memory.ts)
 * - PersonaSeed (persona/seed.ts)
 * - ReputationDatabase (reputation/reputation-db.ts)
 * - GossipDatabase (reputation/gossip-db.ts)
 * - SocialNetwork (network/social-network.ts)
 * - GossipEngine (reputation/gossip.ts)
 * - Scenario plugins (scenarios/*.ts)
 * - ReputationUpdater (reputation/reputation-update.ts)
 */

import {
  createAgentState,
  advanceStep,
  setRole,
  recordOutcome,
  addComplaint,
  drainComplaints,
  addBind,
  removeBind,
  addToBlackList,
  isBlackListed,
  updateLearned,
  recordObservation,
  clearObservations,
  serializeAgentState,
  deserializeAgentState,
} from '../src/persona/scratch';

import { AssociativeMemory } from '../src/persona/memory';

import {
  generatePersonaSeeds,
  createAgentsFromSeeds,
} from '../src/persona/seed';

import {
  ReputationDatabase,
  createNumericalRecord,
  computeAggregateScore,
} from '../src/reputation/reputation-db';

import { GossipDatabase } from '../src/reputation/gossip-db';

import { SocialNetwork } from '../src/network/social-network';

import { GossipEngine, mockGossipEvaluator } from '../src/reputation/gossip';

import {
  updateReputationPD,
  updateReputationSignUp,
  processObservationUpdates,
} from '../src/reputation/reputation-update';

import { NumericalRecord, ReputationEntry, AgentState } from '../src/types';

// ===== AgentState Tests =====

describe('AgentState (scratch)', () => {
  let state: AgentState;

  beforeEach(() => {
    state = createAgentState('TestAgent', 0);
  });

  test('creates with default values', () => {
    expect(state.name).toBe('TestAgent');
    expect(state.id).toBe(0);
    expect(state.role).toBeNull();
    expect(state.currentStep).toBe(0);
    expect(state.resourcesUnit).toBe(10);
    expect(state.complainBuffer).toEqual([]);
    expect(state.relationship.bindList).toEqual([]);
    expect(state.relationship.blackList).toEqual([]);
  });

  test('advances step', () => {
    advanceStep(state);
    expect(state.currentStep).toBe(1);
    advanceStep(state);
    expect(state.currentStep).toBe(2);
  });

  test('sets role', () => {
    setRole(state, 'investor');
    expect(state.role).toBe('investor');
  });

  test('records outcomes', () => {
    recordOutcome(state, 'investor', true);
    recordOutcome(state, 'investor', false);
    recordOutcome(state, 'investor', true);
    expect(state.successCounts['investor']).toEqual({ total: 3, success: 2 });
  });

  test('manages complaints', () => {
    addComplaint(state, 'complaint-1');
    addComplaint(state, 'complaint-2');
    expect(state.complainBuffer).toHaveLength(2);

    const drained = drainComplaints(state);
    expect(drained).toEqual(['complaint-1', 'complaint-2']);
    expect(state.complainBuffer).toEqual([]);
  });

  test('manages bind list', () => {
    addBind(state, 'Agent1', 'investor');
    addBind(state, 'Agent2', 'trustee');
    expect(state.relationship.bindList).toHaveLength(2);

    // No duplicates
    addBind(state, 'Agent1', 'investor');
    expect(state.relationship.bindList).toHaveLength(2);

    removeBind(state, 'Agent1', 'investor');
    expect(state.relationship.bindList).toHaveLength(1);
  });

  test('manages black list with FIFO eviction', () => {
    for (let i = 0; i < 7; i++) {
      addToBlackList(state, `Agent${i}`, 5);
    }
    // Should only have last 5
    expect(state.relationship.blackList).toHaveLength(5);
    expect(state.relationship.blackList[0]).toBe('Agent2');
    expect(isBlackListed(state, 'Agent0')).toBe(false);
    expect(isBlackListed(state, 'Agent6')).toBe(true);
  });

  test('serialization roundtrip', () => {
    updateLearned(state, 'investor', 'cautious');
    recordOutcome(state, 'trustee', true);
    const serialized = serializeAgentState(state);
    const deserialized = deserializeAgentState(
      serialized as Record<string, unknown>
    );
    expect(deserialized.name).toBe(state.name);
    expect(deserialized.learned['investor']).toBe('cautious');
    expect(deserialized.successCounts['trustee']).toEqual({
      total: 1,
      success: 1,
    });
  });
});

// ===== AssociativeMemory Tests =====

describe('AssociativeMemory', () => {
  let memory: AssociativeMemory;

  beforeEach(() => {
    memory = new AssociativeMemory();
  });

  test('adds and retrieves nodes', () => {
    memory.addNode('Agent1', 'invested_in', 'Agent2', 'Invested 5 units', 1);
    memory.addNode('Agent2', 'returned_to', 'Agent1', 'Returned 75%', 1);
    expect(memory.size()).toBe(2);
  });

  test('adds chat nodes', () => {
    const chat = memory.addChat(
      'Agent1',
      'chatted_with',
      'Agent2',
      'Had a conversation',
      'Hello! Hi there!',
      1
    );
    expect(chat.conversation).toBe('Hello! Hi there!');
  });

  test('adds event nodes', () => {
    const event = memory.addEvent(
      'Agent1',
      'observed',
      'Agent2',
      'Saw Agent2 defect',
      'observation',
      5
    );
    expect(event.eventType).toBe('observation');
  });

  test('gets latest N nodes', () => {
    for (let i = 0; i < 10; i++) {
      memory.addNode('A', 'did', 'B', `Event ${i}`, i);
    }
    const latest = memory.getLatest(3);
    expect(latest).toHaveLength(3);
    expect(latest[0].description).toBe('Event 7');
  });

  test('gets latest event with target', () => {
    memory.addNode('A', 'invested', 'B', 'Invested in B', 1);
    memory.addNode('C', 'chatted', 'A', 'Chatted with A', 2);
    memory.addNode('A', 'invested', 'D', 'Invested in D', 3);

    const result = memory.getLatestEventWithTarget('B');
    expect(result?.description).toBe('Invested in B');
  });

  test('gets nodes in step range', () => {
    for (let i = 0; i < 10; i++) {
      memory.addNode('A', 'did', 'B', `Step ${i}`, i);
    }
    const range = memory.getNodesInRange(3, 6);
    expect(range).toHaveLength(4);
  });

  test('serialization roundtrip', () => {
    memory.addNode('A', 'did', 'B', 'Test', 1);
    memory.addChat('A', 'chatted', 'B', 'Chat', 'Hello', 2);
    const json = memory.toJSON();
    const restored = AssociativeMemory.fromJSON(json);
    expect(restored.size()).toBe(2);
  });
});

// ===== PersonaSeed Tests =====

describe('PersonaSeed', () => {
  test('generates correct number of seeds', () => {
    const seeds = generatePersonaSeeds(10, 'test');
    expect(seeds).toHaveLength(10);
    seeds.forEach((s) => {
      expect(s.name).toBeTruthy();
      expect(['rational', 'altruistic']).toContain(s.type);
      expect(s.description).toBeTruthy();
    });
  });

  test('generates more than 20 seeds', () => {
    const seeds = generatePersonaSeeds(25, 'test');
    expect(seeds).toHaveLength(25);
  });

  test('creates agent states from seeds', () => {
    const seeds = generatePersonaSeeds(5, 'test');
    const agents = createAgentsFromSeeds(seeds);
    expect(agents).toHaveLength(5);
    agents.forEach((a, i) => {
      expect(a.id).toBe(i);
      expect(a.learned['personality']).toBeTruthy();
      expect(a.learned['type']).toBeTruthy();
    });
  });

  test('seeds are deterministic with same seed', () => {
    const a = generatePersonaSeeds(10, 'deterministic');
    const b = generatePersonaSeeds(10, 'deterministic');
    expect(a.map((s) => s.name)).toEqual(b.map((s) => s.name));
  });
});

// ===== ReputationDatabase Tests =====

describe('ReputationDatabase', () => {
  let db: ReputationDatabase;

  beforeEach(() => {
    db = new ReputationDatabase('agent-0');
  });

  test('creates zero numerical record', () => {
    const record = createNumericalRecord();
    expect(record.investmentFailures).toBe(0);
    expect(record.trusteeFailures).toBe(0);
    expect(record.returnIssues).toBe(0);
    expect(record.returnSuccesses).toBe(0);
    expect(record.investorSuccesses).toBe(0);
  });

  test('computes aggregate score', () => {
    // score = investorSuccesses + returnSuccesses - trusteeFailures - investmentFailures
    expect(
      computeAggregateScore({
        investmentFailures: 0,
        trusteeFailures: 0,
        returnIssues: 0,
        returnSuccesses: 3,
        investorSuccesses: 2,
      })
    ).toBe(1); // 5 clamped to 1

    expect(
      computeAggregateScore({
        investmentFailures: 3,
        trusteeFailures: 2,
        returnIssues: 0,
        returnSuccesses: 0,
        investorSuccesses: 0,
      })
    ).toBe(-1); // -5 clamped to -1

    expect(
      computeAggregateScore({
        investmentFailures: 1,
        trusteeFailures: 0,
        returnIssues: 0,
        returnSuccesses: 1,
        investorSuccesses: 0,
      })
    ).toBe(0);
  });

  test('stores and retrieves reputation', () => {
    const entry: ReputationEntry = {
      name: 'Agent1',
      id: 1,
      role: 'trustee',
      content: 'Reliable trustee',
      numericalRecord: {
        investmentFailures: 0,
        trusteeFailures: 0,
        returnIssues: 0,
        returnSuccesses: 3,
        investorSuccesses: 0,
      },
      reason: 'Good returns',
      updatedAtStep: 5,
    };

    db.updateReputation('agent-0', entry);
    const retrieved = db.getReputation('agent-0', '1', 'trustee');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Agent1');
    expect(retrieved!.numericalRecord.returnSuccesses).toBe(3);
  });

  test('archives old reputations on update', () => {
    const entry1: ReputationEntry = {
      name: 'Agent1',
      id: 1,
      role: 'trustee',
      content: 'Version 1',
      numericalRecord: createNumericalRecord(),
      reason: 'Initial',
      updatedAtStep: 1,
    };

    const entry2: ReputationEntry = {
      ...entry1,
      content: 'Version 2',
      updatedAtStep: 5,
    };

    db.updateReputation('agent-0', entry1);
    db.updateReputation('agent-0', entry2);

    const history = db.getReputationHistory(1, 'trustee');
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('Version 1');
  });

  test('gets all reputations by role', () => {
    for (let i = 1; i <= 5; i++) {
      db.updateReputation('agent-0', {
        name: `Agent${i}`,
        id: i,
        role: 'trustee',
        content: '',
        numericalRecord: createNumericalRecord(),
        reason: '',
        updatedAtStep: 1,
      });
    }
    const all = db.getAllReputations('agent-0', 'trustee');
    expect(all).toHaveLength(5);
  });

  test('export/import roundtrip', () => {
    db.updateReputation('agent-0', {
      name: 'Agent1',
      id: 1,
      role: 'trustee',
      content: 'Test',
      numericalRecord: createNumericalRecord(),
      reason: '',
      updatedAtStep: 1,
    });

    const exported = db.export();
    const newDb = new ReputationDatabase('agent-0');
    newDb.import(exported);

    const retrieved = newDb.getReputation('agent-0', '1', 'trustee');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Agent1');
  });
});

// ===== GossipDatabase Tests =====

describe('GossipDatabase', () => {
  let db: GossipDatabase;

  beforeEach(() => {
    db = new GossipDatabase('agent-0');
  });

  test('adds and retrieves gossip', () => {
    db.addGossip(
      [
        {
          complainedName: 'Agent1',
          complainedId: 1,
          complainedRole: 'trustee',
          gossiperRole: 'investor',
          gossipInfo: 'Bad return',
          credibilityLevel: 'credible',
          shouldSpread: true,
          reasons: 'Seems reliable info',
          createdAtStep: 5,
        },
      ],
      5
    );

    const gossip = db.getTargetGossip(1, 'trustee', 10);
    expect(gossip).toHaveLength(1);
    expect(gossip[0].gossipInfo).toBe('Bad return');
  });

  test('respects recency window', () => {
    db.addGossip(
      [
        {
          complainedName: 'Agent1',
          complainedId: 1,
          complainedRole: 'trustee',
          gossiperRole: 'investor',
          gossipInfo: 'Old gossip',
          credibilityLevel: 'credible',
          shouldSpread: false,
          reasons: '',
          createdAtStep: 1,
        },
      ],
      1
    );

    // Within window
    expect(db.getTargetGossip(1, 'trustee', 20, 30)).toHaveLength(1);
    // Outside window
    expect(db.getTargetGossip(1, 'trustee', 50, 30)).toHaveLength(0);
  });

  test('tracks credibility scores', () => {
    db.addGossip(
      [
        {
          complainedName: 'Agent1',
          complainedId: 1,
          complainedRole: 'trustee',
          gossiperRole: 'investor',
          gossipInfo: 'Info 1',
          credibilityLevel: 'very_credible',
          shouldSpread: true,
          reasons: '',
          createdAtStep: 1,
        },
        {
          complainedName: 'Agent1',
          complainedId: 1,
          complainedRole: 'trustee',
          gossiperRole: 'investor',
          gossipInfo: 'Info 2',
          credibilityLevel: 'credible',
          shouldSpread: false,
          reasons: '',
          createdAtStep: 2,
        },
      ],
      2
    );

    // very_credible (weight 2) + credible (weight 1) = 3
    expect(db.getCredibilityScore(1, 'trustee')).toBe(3);
  });

  test('gets spreadable gossip', () => {
    db.addGossip(
      [
        {
          complainedName: 'A',
          complainedId: 1,
          complainedRole: 'r',
          gossiperRole: 'r',
          gossipInfo: 'spread me',
          credibilityLevel: 'credible',
          shouldSpread: true,
          reasons: '',
          createdAtStep: 5,
        },
        {
          complainedName: 'B',
          complainedId: 2,
          complainedRole: 'r',
          gossiperRole: 'r',
          gossipInfo: 'dont spread',
          credibilityLevel: 'uncredible',
          shouldSpread: false,
          reasons: '',
          createdAtStep: 5,
        },
      ],
      5
    );

    const spreadable = db.getSpreadableGossip(10);
    expect(spreadable).toHaveLength(1);
    expect(spreadable[0].gossipInfo).toBe('spread me');
  });

  test('serialization roundtrip', () => {
    db.addGossip(
      [
        {
          complainedName: 'Agent1',
          complainedId: 1,
          complainedRole: 'trustee',
          gossiperRole: 'investor',
          gossipInfo: 'Test',
          credibilityLevel: 'credible',
          shouldSpread: false,
          reasons: '',
          createdAtStep: 1,
        },
      ],
      1
    );

    const json = db.toJSON();
    const restored = GossipDatabase.fromJSON(json);
    expect(restored.size()).toBe(1);
    expect(restored.getCredibilityScore(1, 'trustee')).toBe(1);
  });
});

// ===== SocialNetwork Tests =====

describe('SocialNetwork', () => {
  let network: SocialNetwork;

  beforeEach(() => {
    network = new SocialNetwork(5);
  });

  test('adds and queries edges', () => {
    network.addEdge('A', 'B', 'investor');
    expect(network.hasEdge('A', 'B', 'investor')).toBe(true);
    expect(network.hasEdge('B', 'A', 'investor')).toBe(false); // directed
    expect(network.getConnections('A', 'investor')).toEqual(['B']);
  });

  test('removes edges', () => {
    network.addEdge('A', 'B', 'investor');
    network.removeEdge('A', 'B', 'investor');
    expect(network.hasEdge('A', 'B', 'investor')).toBe(false);
  });

  test('manages black lists with FIFO eviction', () => {
    for (let i = 0; i < 7; i++) {
      network.addToBlackList('A', `Agent${i}`);
    }
    const blackList = network.getBlackList('A');
    expect(blackList).toHaveLength(5);
    expect(blackList[0]).toBe('Agent2');
    expect(network.isBlackListed('A', 'Agent0')).toBe(false);
    expect(network.isBlackListed('A', 'Agent6')).toBe(true);
  });

  test('applies network decisions', () => {
    network.addEdge('A', 'B', 'investor');

    network.applyNetworkDecision('A', 'B', 'investor', 'disconnect');
    expect(network.hasEdge('A', 'B', 'investor')).toBe(false);
    expect(network.isBlackListed('A', 'B')).toBe(true);

    // Can't reconnect when blacklisted
    network.applyNetworkDecision('A', 'B', 'investor', 'connect');
    expect(network.hasEdge('A', 'B', 'investor')).toBe(false);
  });

  test('initializes fully connected network', () => {
    network.initializeFullyConnected(['A', 'B', 'C'], 'investor');
    expect(network.hasEdge('A', 'B', 'investor')).toBe(true);
    expect(network.hasEdge('A', 'C', 'investor')).toBe(true);
    expect(network.hasEdge('B', 'A', 'investor')).toBe(true);
    expect(network.hasEdge('B', 'C', 'investor')).toBe(true);
    expect(network.hasEdge('C', 'A', 'investor')).toBe(true);
    expect(network.hasEdge('C', 'B', 'investor')).toBe(true);
  });

  test('computes density', () => {
    network.initializeFullyConnected(['A', 'B', 'C'], 'investor');
    expect(network.getDensity('investor')).toBe(1); // fully connected

    network.removeEdge('A', 'B', 'investor');
    // 5 of 6 possible edges
    expect(network.getDensity('investor')).toBeCloseTo(5 / 6);
  });

  test('serialization roundtrip', () => {
    network.addEdge('A', 'B', 'investor');
    network.addEdge('B', 'C', 'trustee');
    network.addToBlackList('A', 'D');

    const json = network.toJSON();
    const restored = SocialNetwork.fromJSON(json);

    expect(restored.hasEdge('A', 'B', 'investor')).toBe(true);
    expect(restored.hasEdge('B', 'C', 'trustee')).toBe(true);
    expect(restored.isBlackListed('A', 'D')).toBe(true);
  });
});

// ===== GossipEngine Tests =====

describe('GossipEngine', () => {
  test('executes first-order gossip with mock evaluator', async () => {
    const engine = new GossipEngine({}, mockGossipEvaluator);

    const agents = createAgentsFromSeeds(
      generatePersonaSeeds(4, 'gossip-test')
    );
    agents.forEach((a) => (a.role = 'player'));

    const network = new SocialNetwork();
    network.initializeFullyConnected(
      agents.map((a) => a.name),
      'player'
    );

    const repDBs = new Map<string, ReputationDatabase>();
    const gossipDBs = new Map<string, GossipDatabase>();
    for (const a of agents) {
      repDBs.set(a.name, new ReputationDatabase(a.name));
      gossipDBs.set(a.name, new GossipDatabase(a.name));
    }

    // Add a complaint to first agent
    addComplaint(
      agents[0],
      `${agents[1].name}:player:Defected in PD game`
    );

    const spreadQueue = await engine.executeFirstOrderGossip(
      agents[0],
      agents,
      repDBs,
      gossipDBs,
      network,
      5
    );

    // Should have processed the complaint
    expect(agents[0].complainBuffer).toHaveLength(0);
    // Spread queue may or may not have entries depending on evaluation
    expect(Array.isArray(spreadQueue)).toBe(true);
  });
});

// ===== ReputationUpdate Tests =====

describe('ReputationUpdate', () => {
  test('updates PD reputation correctly', () => {
    const a = createAgentState('PlayerA', 0);
    const b = createAgentState('PlayerB', 1);
    const repA = new ReputationDatabase('PlayerA');
    const repB = new ReputationDatabase('PlayerB');

    updateReputationPD(
      a,
      b,
      {
        payoffs: { PlayerA: 3, PlayerB: 3 },
        actions: { PlayerA: 'cooperate', PlayerB: 'cooperate' },
        history: [],
        metadata: {},
      },
      repA,
      repB,
      1
    );

    // A's view of B: cooperated, so returnSuccesses + investorSuccesses
    const repOfB = repA.getTargetReputation(1, 'player');
    expect(repOfB).not.toBeNull();
    expect(repOfB!.numericalRecord.returnSuccesses).toBe(1);
    expect(repOfB!.numericalRecord.investorSuccesses).toBe(1);
  });

  test('generates complaints on defection', () => {
    const a = createAgentState('PlayerA', 0);
    const b = createAgentState('PlayerB', 1);
    const repA = new ReputationDatabase('PlayerA');
    const repB = new ReputationDatabase('PlayerB');

    updateReputationPD(
      a,
      b,
      {
        payoffs: { PlayerA: 0, PlayerB: 5 },
        actions: { PlayerA: 'cooperate', PlayerB: 'defect' },
        history: [],
        metadata: {},
      },
      repA,
      repB,
      1
    );

    expect(a.complainBuffer).toHaveLength(1);
    expect(a.complainBuffer[0]).toContain('PlayerB');
  });

  test('processes observation updates', () => {
    const observer = createAgentState('Observer', 0);
    const repDB = new ReputationDatabase('Observer');

    recordObservation(observer, 'obs-1', {
      targetName: 'Agent1',
      targetId: 1,
      role: 'trustee',
      behavior: 'Returned 100% in investment',
      outcome: 'positive',
    });

    processObservationUpdates(observer, repDB, 10);

    const rep = repDB.getTargetReputation(1, 'trustee');
    expect(rep).not.toBeNull();
    expect(rep!.numericalRecord.returnSuccesses).toBe(1);
    expect(Object.keys(observer.observed)).toHaveLength(0); // cleared
  });
});

// ===== Scenario Plugin Tests =====

describe('Scenario Plugins', () => {
  // Import scenarios to register them
  beforeAll(() => {
    require('../src/scenarios/mspn-negotiation');
    require('../src/scenarios/investment');
    require('../src/scenarios/prisoner-dilemma');
    require('../src/scenarios/sign-up');
  });

  test('scenarios are registered', () => {
    const { getAvailableScenarios, getScenario } = require('../src/scenarios/scenario');
    const available = getAvailableScenarios();
    expect(available).toContain('mspn');
    expect(available).toContain('investment');
    expect(available).toContain('pd_game');
    expect(available).toContain('sign_up');
  });

  test('MSPN scenario executes', async () => {
    const { getScenario } = require('../src/scenarios/scenario');
    const mspn = getScenario('mspn');
    expect(mspn).toBeDefined();

    const agents = createAgentsFromSeeds(generatePersonaSeeds(4, 'mspn-test'));
    const network = new SocialNetwork();

    const pairs = mspn!.pair(agents, network, 1);
    expect(pairs.length).toBeGreaterThan(0);

    const result = await mspn!.execute(pairs[0], {
      step: 1,
      network,
      reputationBackend: null,
      gossipEngine: null,
      config: {
        agentCount: 4,
        scenario: 'mspn' as const,
        enableGossip: false,
        enableNetwork: false,
        reputationBackend: 'karma' as const,
        gossipConfig: { maxSpreadDepth: 2, credibilityDecay: 0.3, recentWindow: 30 },
        networkConfig: { blackListMaxSize: 5, observationInterval: 5 },
      },
      mockMode: true,
    });

    expect(result.payoffs).toBeDefined();
    expect(result.history.length).toBeGreaterThan(0);
  });

  test('Investment scenario executes', async () => {
    const { getScenario } = require('../src/scenarios/scenario');
    const investment = getScenario('investment');

    const agents = createAgentsFromSeeds(generatePersonaSeeds(4, 'invest-test'));
    const network = new SocialNetwork();
    network.initializeFullyConnected(
      agents.map((a) => a.name),
      'investor'
    );

    const pairs = investment!.pair(agents, network, 1);
    expect(pairs.length).toBeGreaterThan(0);

    const result = await investment!.execute(pairs[0], {
      step: 1,
      network,
      reputationBackend: null,
      gossipEngine: null,
      config: {
        agentCount: 4,
        scenario: 'investment' as const,
        enableGossip: false,
        enableNetwork: false,
        reputationBackend: 'repunet' as const,
        gossipConfig: { maxSpreadDepth: 2, credibilityDecay: 0.3, recentWindow: 30 },
        networkConfig: { blackListMaxSize: 5, observationInterval: 5 },
      },
      mockMode: true,
    });

    expect(result.payoffs).toBeDefined();
    expect(result.metadata.stage).toBeDefined();
  });

  test('PD scenario executes', async () => {
    const { getScenario } = require('../src/scenarios/scenario');
    const pd = getScenario('pd_game');

    const agents = createAgentsFromSeeds(generatePersonaSeeds(4, 'pd-test'));
    const network = new SocialNetwork();

    const pairs = pd!.pair(agents, network, 1);
    expect(pairs.length).toBeGreaterThan(0);

    const result = await pd!.execute(pairs[0], {
      step: 1,
      network,
      reputationBackend: null,
      gossipEngine: null,
      config: {
        agentCount: 4,
        scenario: 'pd_game' as const,
        enableGossip: false,
        enableNetwork: false,
        reputationBackend: 'repunet' as const,
        gossipConfig: { maxSpreadDepth: 2, credibilityDecay: 0.3, recentWindow: 30 },
        networkConfig: { blackListMaxSize: 5, observationInterval: 5 },
      },
      mockMode: true,
    });

    expect(result.payoffs).toBeDefined();
    expect(result.metadata.actionA).toBeDefined();
    expect(result.metadata.actionB).toBeDefined();
  });

  test('Sign-up scenario executes', async () => {
    const { getScenario } = require('../src/scenarios/scenario');
    const signup = getScenario('sign_up');

    const agents = createAgentsFromSeeds(generatePersonaSeeds(4, 'signup-test'));
    const network = new SocialNetwork();

    const pairs = signup!.pair(agents, network, 1);
    expect(pairs.length).toBeGreaterThan(0);

    const result = await signup!.execute(pairs[0], {
      step: 1,
      network,
      reputationBackend: null,
      gossipEngine: null,
      config: {
        agentCount: 4,
        scenario: 'sign_up' as const,
        enableGossip: false,
        enableNetwork: false,
        reputationBackend: 'repunet' as const,
        gossipConfig: { maxSpreadDepth: 2, credibilityDecay: 0.3, recentWindow: 30 },
        networkConfig: { blackListMaxSize: 5, observationInterval: 5 },
      },
      mockMode: true,
    });

    expect(result.payoffs).toBeDefined();
    expect(result.history.length).toBeGreaterThan(0);
  });
});

// ===== Integration: Multi-Agent Simulation Smoke Test =====

describe('Multi-Agent Simulation Smoke Test', () => {
  test('20-agent 5-step PD simulation completes', async () => {
    const { getScenario } = require('../src/scenarios/scenario');
    const pd = getScenario('pd_game')!;

    const agents = createAgentsFromSeeds(generatePersonaSeeds(20, 'smoke-test'));
    const network = new SocialNetwork();
    network.initializeFullyConnected(
      agents.map((a) => a.name),
      'player'
    );

    const repDBs = new Map<string, ReputationDatabase>();
    const gossipDBs = new Map<string, GossipDatabase>();
    for (const a of agents) {
      repDBs.set(a.name, new ReputationDatabase(a.name));
      gossipDBs.set(a.name, new GossipDatabase(a.name));
    }

    const gossipEngine = new GossipEngine();
    const config = {
      agentCount: 20,
      scenario: 'pd_game' as const,
      enableGossip: true,
      enableNetwork: true,
      reputationBackend: 'repunet' as const,
      gossipConfig: { maxSpreadDepth: 2, credibilityDecay: 0.3, recentWindow: 30 },
      networkConfig: { blackListMaxSize: 5, observationInterval: 5 },
    };

    const allResults: any[] = [];

    for (let step = 1; step <= 5; step++) {
      const pairs = pd.pair(agents, network, step);

      for (const pair of pairs) {
        const result = await pd.execute(pair, {
          step,
          network,
          reputationBackend: null,
          gossipEngine,
          config,
          mockMode: true,
        });
        allResults.push(result);

        // Reputation updates
        updateReputationPD(
          pair[0],
          pair[1],
          result,
          repDBs.get(pair[0].name)!,
          repDBs.get(pair[1].name)!,
          step
        );
      }

      // Gossip phase (serialized)
      for (const agent of agents) {
        const spreadQueue = await gossipEngine.executeFirstOrderGossip(
          agent,
          agents,
          repDBs,
          gossipDBs,
          network,
          step
        );

        if (spreadQueue.length > 0) {
          await gossipEngine.executeSecondOrderGossip(
            agent,
            spreadQueue,
            agents,
            repDBs,
            gossipDBs,
            network,
            step
          );
        }
      }
    }

    expect(allResults.length).toBeGreaterThan(0);

    // Verify reputation was tracked
    let totalRepEntries = 0;
    for (const db of repDBs.values()) {
      totalRepEntries += db.getAllReputations('', 'player').length;
    }
    expect(totalRepEntries).toBeGreaterThan(0);

    // Verify network still has connections
    expect(network.getTotalEdgeCount()).toBeGreaterThan(0);
  });
});
