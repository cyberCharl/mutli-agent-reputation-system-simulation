import { MultiAgentSimulator } from '../../src/simulator';

describe('integration: reputation convergence sanity', () => {
  test('cooperative PD interactions move average reputation positive', async () => {
    const simulator = new MultiAgentSimulator(
      {
        scenario: 'pd_game',
        agentCount: 6,
        enableGossip: false,
      },
      {
        seed: 'rep-converge',
        decisionProvider: {
          decidePDAction: async () => ({
            action: 'cooperate',
            reasoning: 'deterministic integration test',
          }),
        },
      }
    );

    await simulator.initialize();
    await simulator.runSteps(4);

    const stats = simulator.getReputationDb().getStats();
    expect(stats.totalEntries).toBeGreaterThan(0);
    expect(stats.averageScore).toBeGreaterThan(0);
  });
});
