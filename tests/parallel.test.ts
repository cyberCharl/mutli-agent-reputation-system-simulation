import { runABTest, runEpisode } from '../src/simulator';

describe('Parallel Episode Execution', () => {
  test('should produce results with concurrency=1 (sequential)', async () => {
    const result = await runABTest(5, undefined, 'seq-test', 1);
    expect(result.baseline.totalEpisodes).toBe(5);
    expect(result.withReputation.totalEpisodes).toBe(5);
  }, 30000);

  test('should produce results with concurrency=4 (parallel)', async () => {
    const result = await runABTest(5, undefined, 'par-test', 4);
    expect(result.baseline.totalEpisodes).toBe(5);
    expect(result.withReputation.totalEpisodes).toBe(5);
  }, 30000);

  test('should handle high concurrency without errors', async () => {
    const result = await runABTest(10, undefined, 'high-conc', 10);
    expect(result.baseline.totalEpisodes).toBe(10);
    expect(result.withReputation.totalEpisodes).toBe(10);
  }, 30000);

  test('should run individual episodes independently', async () => {
    const results = await Promise.all([
      runEpisode(0, undefined, false, 'ind-1'),
      runEpisode(1, undefined, false, 'ind-2'),
      runEpisode(2, undefined, false, 'ind-3'),
    ]);

    expect(results).toHaveLength(3);
    results.forEach((r, i) => {
      expect(r.episodeId).toBe(i);
      expect(r.payoffs).toBeDefined();
    });
  }, 15000);

  test('should clamp concurrency to at least 1', async () => {
    const result = await runABTest(3, undefined, 'clamp-test', 0);
    expect(result.baseline.totalEpisodes).toBe(3);
  }, 30000);
});
