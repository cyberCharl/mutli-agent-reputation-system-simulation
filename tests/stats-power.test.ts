import {
  computeAchievedPower,
  computeRequiredSampleSize,
  summarizePowerAnalysis,
} from '../src/stats';

describe('power analysis', () => {
  test('computes required sample size close to Cohen reference case', () => {
    const sampleSize = computeRequiredSampleSize(0.8, 0.05, 0.5);
    expect(sampleSize).toBe(63);
  });

  test('computes achieved power for the reference case', () => {
    const achievedPower = computeAchievedPower(63, 0.05, 0.5);
    expect(achievedPower).toBeGreaterThan(0.79);
    expect(achievedPower).toBeLessThan(0.82);
  });

  test('returns zero power for a zero-sized observed effect', () => {
    expect(computeAchievedPower(100, 0.05, 0)).toBe(0);
  });

  test('summarizes required and planned power together', () => {
    const summary = summarizePowerAnalysis(0.8, 0.05, 0.5, 80);
    expect(summary.requiredSampleSize).toBe(63);
    expect(summary.effectSize).toBe(0.5);
    expect(summary.achievedPower).toBeGreaterThan(0.88);
  });

  test('rejects invalid planning inputs', () => {
    expect(() => computeRequiredSampleSize(1.1, 0.05, 0.5)).toThrow(
      'Target power must be between 0 and 1'
    );
    expect(() => computeRequiredSampleSize(0.8, 0, 0.5)).toThrow(
      'Alpha must be between 0 and 1'
    );
    expect(() => computeRequiredSampleSize(0.8, 0.05, 0)).toThrow(
      'Expected effect size must be non-zero'
    );
  });
});
