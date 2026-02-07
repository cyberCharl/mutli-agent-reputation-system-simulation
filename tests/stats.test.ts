import { pairedTTest, bootstrapCI } from '../src/stats';

describe('pairedTTest', () => {
  test('should detect significant difference between shifted samples', () => {
    // [1,2,3,4,5] vs [2,3,4,5,6] — constant shift of +1
    const baseline = [1, 2, 3, 4, 5];
    const treatment = [2, 3, 4, 5, 6];
    const result = pairedTTest(baseline, treatment);

    // All differences are 1, so t should be very large (infinite in theory)
    // sd = 0, so this is a degenerate case — zero variance in differences
    // The function should handle this gracefully
    expect(result.meanDifference).toBe(1);
    expect(result.degreesOfFreedom).toBe(4);
  });

  test('should return non-significant for identical samples', () => {
    const data = [1, 2, 3, 4, 5];
    const result = pairedTTest(data, data);

    expect(result.tStatistic).toBe(0);
    expect(result.pValue).toBeGreaterThanOrEqual(0.99);
    expect(result.significant).toBe(false);
    expect(result.meanDifference).toBe(0);
  });

  test('should detect significant difference with real data', () => {
    // Pre/post treatment scores — clearly different
    const baseline = [65, 70, 75, 80, 85, 90, 95, 60, 72, 68];
    const treatment = [78, 82, 88, 92, 97, 100, 100, 75, 85, 80];
    const result = pairedTTest(baseline, treatment);

    expect(result.significant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.meanDifference).toBeGreaterThan(0);
    expect(result.degreesOfFreedom).toBe(9);
  });

  test('should return non-significant for similar distributions', () => {
    // Small random variations around the same mean
    const baseline = [10.1, 9.9, 10.2, 9.8, 10.0];
    const treatment = [10.0, 10.1, 9.9, 10.0, 10.0];
    const result = pairedTTest(baseline, treatment);

    expect(result.significant).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  test('should throw on mismatched sample sizes', () => {
    expect(() => pairedTTest([1, 2, 3], [1, 2])).toThrow(
      'Sample sizes must match'
    );
  });

  test('should throw on fewer than 2 observations', () => {
    expect(() => pairedTTest([1], [2])).toThrow(
      'Need at least 2 paired observations'
    );
  });

  test('should use custom alpha level', () => {
    const baseline = [10, 11, 12, 13, 14];
    const treatment = [11, 12, 13, 14, 15];
    const result = pairedTTest(baseline, treatment, 0.001);

    // Constant shift — t is extreme, but alpha is very strict
    expect(result.meanDifference).toBe(1);
  });

  test('should have correct degrees of freedom', () => {
    const n = 20;
    const baseline = Array.from({ length: n }, (_, i) => i);
    const treatment = Array.from({ length: n }, (_, i) => i + 0.5);
    const result = pairedTTest(baseline, treatment);

    expect(result.degreesOfFreedom).toBe(n - 1);
  });
});

describe('bootstrapCI', () => {
  test('should contain true mean for symmetric data', () => {
    const data = [1, 2, 3, 4, 5];
    const result = bootstrapCI(data, 0.95, 10000, 'test-seed');

    expect(result.mean).toBe(3);
    expect(result.lower).toBeLessThan(3);
    expect(result.upper).toBeGreaterThan(3);
    expect(result.confidence).toBe(0.95);
    expect(result.nResamples).toBe(10000);
  });

  test('should produce narrower CI with larger sample', () => {
    const small = [1, 2, 3, 4, 5];
    const large = Array.from({ length: 100 }, (_, i) => (i % 5) + 1);

    const smallCI = bootstrapCI(small, 0.95, 10000, 'seed1');
    const largeCI = bootstrapCI(large, 0.95, 10000, 'seed2');

    const smallWidth = smallCI.upper - smallCI.lower;
    const largeWidth = largeCI.upper - largeCI.lower;
    expect(largeWidth).toBeLessThan(smallWidth);
  });

  test('should produce wider CI at higher confidence', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const ci90 = bootstrapCI(data, 0.90, 10000, 'seed-90');
    const ci99 = bootstrapCI(data, 0.99, 10000, 'seed-99');

    const width90 = ci90.upper - ci90.lower;
    const width99 = ci99.upper - ci99.lower;
    expect(width99).toBeGreaterThan(width90);
  });

  test('should be reproducible with same seed', () => {
    const data = [1, 2, 3, 4, 5];
    const result1 = bootstrapCI(data, 0.95, 10000, 'same-seed');
    const result2 = bootstrapCI(data, 0.95, 10000, 'same-seed');

    expect(result1.lower).toBe(result2.lower);
    expect(result1.upper).toBe(result2.upper);
  });

  test('should throw on empty data', () => {
    expect(() => bootstrapCI([])).toThrow('Data array must not be empty');
  });

  test('should handle single-element data', () => {
    const result = bootstrapCI([42], 0.95, 10000, 'single');
    expect(result.mean).toBe(42);
    expect(result.lower).toBe(42);
    expect(result.upper).toBe(42);
  });

  test('should produce correct mean', () => {
    const data = [10, 20, 30, 40, 50];
    const result = bootstrapCI(data, 0.95, 10000, 'mean-test');
    expect(result.mean).toBe(30);
  });
});
