import { PowerAnalysis } from '../types';

const MIN_EFFECT_SIZE = 1e-9;

export function computeRequiredSampleSize(
  targetPower: number,
  alpha: number,
  expectedEffectSize: number
): number {
  validatePowerInputs(targetPower, alpha, expectedEffectSize);

  const zAlpha = inverseStandardNormal(1 - alpha / 2);
  const zBeta = inverseStandardNormal(targetPower);
  const n =
    2 * ((zAlpha + zBeta) / Math.max(Math.abs(expectedEffectSize), MIN_EFFECT_SIZE)) ** 2;

  return Math.max(2, Math.ceil(n));
}

export function computeAchievedPower(
  sampleSize: number,
  alpha: number,
  observedEffectSize: number
): number {
  if (!Number.isFinite(sampleSize) || sampleSize < 2) {
    throw new Error('Sample size must be at least 2');
  }
  validateAlpha(alpha);

  const effectSize = Math.abs(observedEffectSize);
  if (!Number.isFinite(effectSize) || effectSize < MIN_EFFECT_SIZE) {
    return 0;
  }

  const zAlpha = inverseStandardNormal(1 - alpha / 2);
  const nonCentrality = Math.sqrt(sampleSize / 2) * effectSize;
  const power = standardNormalCdf(nonCentrality - zAlpha);

  return clampProbability(power);
}

export function summarizePowerAnalysis(
  targetPower: number,
  alpha: number,
  expectedEffectSize: number,
  plannedSampleSize?: number
): PowerAnalysis {
  const requiredSampleSize = computeRequiredSampleSize(
    targetPower,
    alpha,
    expectedEffectSize
  );

  return {
    requiredSampleSize,
    achievedPower: computeAchievedPower(
      plannedSampleSize ?? requiredSampleSize,
      alpha,
      expectedEffectSize
    ),
    effectSize: expectedEffectSize,
    alpha,
  };
}

function validatePowerInputs(
  targetPower: number,
  alpha: number,
  expectedEffectSize: number
): void {
  if (!Number.isFinite(targetPower) || targetPower <= 0 || targetPower >= 1) {
    throw new Error('Target power must be between 0 and 1');
  }
  validateAlpha(alpha);
  if (
    !Number.isFinite(expectedEffectSize) ||
    Math.abs(expectedEffectSize) < MIN_EFFECT_SIZE
  ) {
    throw new Error('Expected effect size must be non-zero');
  }
}

function validateAlpha(alpha: number): void {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new Error('Alpha must be between 0 and 1');
  }
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, round(value, 6)));
}

function standardNormalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x));

  return sign * y;
}

function inverseStandardNormal(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error('Probability must be between 0 and 1');
  }

  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416,
  ];

  const low = 0.02425;
  const high = 1 - low;

  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  const q = probability - 0.5;
  const r = q * q;
  return (
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
    q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
