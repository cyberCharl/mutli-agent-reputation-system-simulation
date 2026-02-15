import { MultiAgentSimulator } from '../../src/simulator';

type NetworkExport = {
  edges: Array<{ from: string; to: string; role: string; createdAt: number }>;
  blackLists: Record<string, string[]>;
};

describe('integration: network evolution basic behavior', () => {
  test('network edges remain valid and stable across steps', async () => {
    const simulator = new MultiAgentSimulator(
      {
        scenario: 'investment',
        agentCount: 8,
        enableGossip: false,
        networkConfig: {
          enabled: true,
          blackListMaxSize: 5,
          observationInterval: 3,
          initialConnectivity: 0.5,
        },
      },
      {
        seed: 'network-basic',
        decisionProvider: {
          decideInvestmentAccept: async () => ({
            accept: true,
            reasoning: 'test',
          }),
          decideInvestmentAmount: async () => ({
            amount: 4,
            reasoning: 'test',
          }),
          decideInvestmentReturn: async () => ({
            percentage: '100',
            reasoning: 'test',
          }),
        },
      }
    );

    await simulator.initialize();

    const before = (
      simulator as unknown as { network: { export: () => NetworkExport } }
    ).network.export();
    await simulator.runSteps(3);
    const after = (
      simulator as unknown as { network: { export: () => NetworkExport } }
    ).network.export();

    expect(before.edges.length).toBeGreaterThan(0);
    expect(after.edges.length).toBe(before.edges.length);
    expect(after.edges.every((edge) => edge.from !== edge.to)).toBe(true);
  });
});
