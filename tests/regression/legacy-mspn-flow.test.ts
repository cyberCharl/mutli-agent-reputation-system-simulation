import { runABTest, runEpisode } from '../../src/simulator';

describe('regression: legacy MSPN flow', () => {
  test('runEpisode baseline path remains functional', async () => {
    const result = await runEpisode(0, undefined, false, 'legacy-episode');
    expect(result.episodeId).toBe(0);
    expect(typeof result.payoffs.a).toBe('number');
    expect(typeof result.payoffs.b).toBe('number');
    expect(result.roundCount).toBeGreaterThanOrEqual(1);
  });

  test('runABTest baseline and reputation paths still execute', async () => {
    const result = await runABTest(2, undefined, 'legacy-ab', 1);
    expect(result.baseline.totalEpisodes).toBe(2);
    expect(result.withReputation.totalEpisodes).toBe(2);
  }, 30000);
});
