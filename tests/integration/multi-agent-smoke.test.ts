import { MultiAgentSimulator } from '../../src/simulator';

describe('MultiAgentSimulator smoke tests', () => {
  test('runs investment step with deterministic decision provider', async () => {
    const simulator = new MultiAgentSimulator(
      {
        scenario: 'investment',
        agentCount: 6,
        enableGossip: false,
      },
      {
        seed: 'smoke-investment',
        decisionProvider: {
          decideInvestmentAccept: async () => ({
            accept: true,
            reasoning: 'test',
          }),
          decideInvestmentAmount: async () => ({
            amount: 3,
            reasoning: 'test',
          }),
          decideInvestmentReturn: async () => ({
            percentage: '75',
            reasoning: 'test',
          }),
        },
      }
    );

    await simulator.initialize();
    const output = await simulator.runStep(1);

    expect(simulator.getPersonaCount()).toBe(6);
    expect(output.results.length).toBeGreaterThan(0);
    expect(simulator.getScenarioName()).toBe('investment');
  });

  test('runs short prison-dilemma simulation without external calls', async () => {
    const simulator = new MultiAgentSimulator(
      {
        scenario: 'pd_game',
        agentCount: 4,
        enableGossip: false,
      },
      {
        seed: 'smoke-pd',
        decisionProvider: {
          decidePDAction: async ({ self }) => ({
            action: self.state.id % 2 === 0 ? 'defect' : 'cooperate',
            reasoning: 'test',
          }),
        },
      }
    );

    await simulator.initialize();
    const steps = await simulator.runSteps(2);

    expect(steps).toHaveLength(2);
    expect(steps[0].results.length).toBeGreaterThan(0);
  });
});
