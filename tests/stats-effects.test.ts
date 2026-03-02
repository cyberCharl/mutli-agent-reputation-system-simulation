import {
  cliffsDelta,
  cohensD,
  glassDelta,
  interpretCliffsDelta,
  interpretEffectSize,
} from '../src/stats';

describe('effect size calculations', () => {
  test("computes Cohen's d for shifted samples", () => {
    expect(cohensD([1, 2, 3], [2, 3, 4])).toBe(1);
  });

  test("computes Glass's delta using the baseline standard deviation", () => {
    expect(glassDelta([1, 2, 3], [2, 3, 4])).toBe(1);
  });

  test("computes Cliff's delta for complete stochastic dominance", () => {
    expect(cliffsDelta([1, 2, 3], [4, 5, 6])).toBe(1);
  });

  test("computes Cliff's delta for overlapping samples", () => {
    expect(cliffsDelta([1, 2, 3], [2, 3, 4])).toBe(0.555556);
  });

  test('interprets standardized effect sizes', () => {
    expect(interpretEffectSize(0.1)).toBe('negligible');
    expect(interpretEffectSize(0.35)).toBe('small');
    expect(interpretEffectSize(0.6)).toBe('medium');
    expect(interpretEffectSize(1.2)).toBe('large');
  });

  test("interprets Cliff's delta with rank-based thresholds", () => {
    expect(interpretCliffsDelta(0.1)).toBe('negligible');
    expect(interpretCliffsDelta(0.2)).toBe('small');
    expect(interpretCliffsDelta(0.4)).toBe('medium');
    expect(interpretCliffsDelta(0.6)).toBe('large');
  });

  test('rejects empty samples', () => {
    expect(() => cohensD([], [1, 2, 3])).toThrow('Samples must not be empty');
    expect(() => cliffsDelta([1, 2, 3], [])).toThrow(
      'Samples must not be empty'
    );
  });
});
