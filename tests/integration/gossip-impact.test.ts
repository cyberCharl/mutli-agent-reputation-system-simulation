import { MultiAgentSimulator } from '../../src/simulator';

function makeSimulator(enableGossip: boolean): MultiAgentSimulator {
  return new MultiAgentSimulator(
    {
      scenario: 'investment',
      agentCount: 6,
      enableGossip,
      gossipConfig: {
        enabled: enableGossip,
        maxSpreadDepth: 2,
        credibilityDecay: 0.3,
        recentWindow: 10,
        listenerSelection: 'random',
      },
    },
    {
      seed: 'gossip-impact',
      decisionProvider: {
        decideInvestmentAccept: async () => ({
          accept: true,
          reasoning: 'test',
        }),
        decideInvestmentAmount: async () => ({ amount: 10, reasoning: 'test' }),
        decideInvestmentReturn: async () => ({
          percentage: '0',
          reasoning: 'force gossip path',
        }),
      },
    }
  );
}

describe('integration: gossip impact signal', () => {
  test('enabling gossip changes reputation footprint and records gossip entries', async () => {
    const withGossip = makeSimulator(true);
    const withoutGossip = makeSimulator(false);

    await withGossip.initialize();
    await withoutGossip.initialize();

    await withGossip.runSteps(3);
    await withoutGossip.runSteps(3);

    const withStats = withGossip.getReputationDb().getStats();
    const withoutStats = withoutGossip.getReputationDb().getStats();
    const gossipEntries = (
      withGossip as unknown as { gossipDb: { getAllEntries: () => unknown[] } }
    ).gossipDb.getAllEntries().length;

    expect(gossipEntries).toBeGreaterThan(0);
    expect(withStats.totalEntries).toBeGreaterThan(withoutStats.totalEntries);
  });
});
