import { LLMModel, Persona } from '../../src/agent';
import { SocialNetwork } from '../../src/network';
import {
  GossipDatabase,
  GossipEngine,
  ReputationDatabase,
  ReputationUpdater,
} from '../../src/reputation';
import {
  InvestmentScenario,
  MSPNNegotiationScenario,
  PrisonerDilemmaScenario,
  ScenarioContext,
  SignUpScenario,
} from '../../src/scenarios';
import { SimulationConfig } from '../../src/types';

function makeConfig(scenario: SimulationConfig['scenario']): SimulationConfig {
  return {
    maxRounds: 3,
    beliefUpdateStrength: { proposal: 0.2, review: 0.15 },
    payoffNoise: 0,
    initialBeliefAlignment: 0.5,
    agentCount: 4,
    scenario,
    reputationBackend: 'repunet',
    enableGossip: false,
    gossipConfig: {
      enabled: false,
      maxSpreadDepth: 2,
      credibilityDecay: 0.3,
      recentWindow: 30,
      listenerSelection: 'random',
    },
    enableNetwork: true,
    networkConfig: {
      enabled: true,
      blackListMaxSize: 5,
      observationInterval: 5,
      initialConnectivity: 0.2,
    },
    storageConfig: {
      basePath: './sim_storage',
      runId: 'test',
      persistInterval: 1,
    },
    ablationMode: 'minimal',
  };
}

function makePersonas(count: number): Persona[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new Persona(
        {
          id: i + 1,
          name: `P${i + 1}`,
          role: 'player',
          innate: 'test persona',
        },
        new LLMModel('mock', undefined, `seed-${i}`)
      )
  );
}

function makeContext(
  config: SimulationConfig,
  overrides: Partial<ScenarioContext> = {}
): ScenarioContext {
  const reputationDb = new ReputationDatabase();
  const context: ScenarioContext = {
    step: 1,
    network: new SocialNetwork(config.networkConfig),
    reputationDb,
    reputationUpdater: new ReputationUpdater(reputationDb),
    gossipEngine: null,
    config,
    decisionProvider: undefined,
    rng: () => 0.5,
  };
  return { ...context, ...overrides };
}

describe('Scenario implementations', () => {
  test('investment executes deterministic flow and updates reputation', async () => {
    const scenario = new InvestmentScenario();
    const personas = makePersonas(4);
    const config = makeConfig('investment');
    const context = makeContext(config, {
      decisionProvider: {
        decideInvestmentAccept: async () => ({
          accept: true,
          reasoning: 'test',
        }),
        decideInvestmentAmount: async () => ({ amount: 4, reasoning: 'test' }),
        decideInvestmentReturn: async () => ({
          percentage: '100',
          reasoning: 'test',
        }),
      },
    });

    const [pair] = await scenario.pair(personas, context.network, config, 1);
    const result = await scenario.execute(pair, context);
    await scenario.updateReputation(pair, result, context);

    expect(result.actions.accept).toBe('true');
    expect(result.payoffs[pair[0].state.name]).toBe(8);
    expect(context.reputationDb.getAllReputations(pair[0].getId()).length).toBe(
      1
    );
  });

  test('prisoner dilemma uses provided decisions and payoff matrix', async () => {
    const scenario = new PrisonerDilemmaScenario();
    const personas = makePersonas(2);
    const config = makeConfig('pd_game');
    const context = makeContext(config, {
      decisionProvider: {
        decidePDAction: async ({ self }) => ({
          action: self.state.name === 'P1' ? 'cooperate' : 'defect',
          reasoning: 'test',
        }),
      },
    });

    const [pair] = await scenario.pair(personas, context.network, config, 1);
    const result = await scenario.execute(pair, context);

    expect(result.payoffs[pair[0].state.name]).toBe(0);
    expect(result.payoffs[pair[1].state.name]).toBe(5);
    expect(scenario.shouldTriggerGossip(result)).toBe(true);
  });

  test('sign-up scenario rewards mutual sign-up', async () => {
    const scenario = new SignUpScenario();
    const personas = makePersonas(2);
    const config = makeConfig('sign_up');
    const context = makeContext(config, {
      decisionProvider: {
        decideSignUpAction: async () => ({
          action: 'sign_up',
          reasoning: 'test',
        }),
      },
    });

    const [pair] = await scenario.pair(personas, context.network, config, 1);
    const result = await scenario.execute(pair, context);

    expect(result.payoffs[pair[0].state.name]).toBe(2);
    expect(result.payoffs[pair[1].state.name]).toBe(2);
  });

  test('mspn negotiation pairs agents in twos', async () => {
    const scenario = new MSPNNegotiationScenario();
    const personas = makePersonas(4);
    const config = makeConfig('mspn');
    const context = makeContext(config, {
      gossipEngine: new GossipEngine(
        {
          enabled: true,
          maxSpreadDepth: 2,
          credibilityDecay: 0.3,
          recentWindow: 30,
          listenerSelection: 'random',
        },
        new GossipDatabase(),
        new ReputationDatabase()
      ),
    });

    const pairs = await scenario.pair(personas, context.network, config, 1);
    expect(pairs.length).toBe(2);
  });
});
