import seedrandom from 'seedrandom';

export interface TTestResult {
  tStatistic: number;
  pValue: number;
  significant: boolean; // at alpha = 0.05
  degreesOfFreedom: number;
  meanDifference: number;
}

export interface BootstrapCIResult {
  mean: number;
  lower: number;
  upper: number;
  confidence: number;
  nResamples: number;
}

/**
 * Paired t-test for two related samples.
 * Tests H0: mean difference = 0 vs H1: mean difference != 0.
 */
export function pairedTTest(
  baseline: number[],
  treatment: number[],
  alpha: number = 0.05
): TTestResult {
  if (baseline.length !== treatment.length) {
    throw new Error(
      `Sample sizes must match: baseline=${baseline.length}, treatment=${treatment.length}`
    );
  }

  const n = baseline.length;
  if (n < 2) {
    throw new Error('Need at least 2 paired observations');
  }

  // Calculate differences
  const diffs = baseline.map((b, i) => treatment[i] - b);

  // Mean of differences
  const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;

  // Standard deviation of differences
  const variance =
    diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);

  // t-statistic
  const se = sd / Math.sqrt(n);
  const tStatistic = se === 0 ? 0 : meanDiff / se;

  // Degrees of freedom
  const df = n - 1;

  // Two-tailed p-value using t-distribution approximation
  const pValue = tDistPValue(Math.abs(tStatistic), df);

  return {
    tStatistic: round(tStatistic, 4),
    pValue: round(pValue, 6),
    significant: pValue < alpha,
    degreesOfFreedom: df,
    meanDifference: round(meanDiff, 4),
  };
}

/**
 * Bootstrap confidence interval for the mean of a sample.
 */
export function bootstrapCI(
  data: number[],
  confidence: number = 0.95,
  nResamples: number = 10000,
  seed?: string
): BootstrapCIResult {
  if (data.length === 0) {
    throw new Error('Data array must not be empty');
  }

  const rng = seed ? seedrandom(seed) : seedrandom();
  const n = data.length;
  const means: number[] = [];

  for (let i = 0; i < nResamples; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += data[idx];
    }
    means.push(sum / n);
  }

  // Sort bootstrap means
  means.sort((a, b) => a - b);

  // Percentile method
  const alpha = 1 - confidence;
  const lowerIdx = Math.floor((alpha / 2) * nResamples);
  const upperIdx = Math.floor((1 - alpha / 2) * nResamples);

  const sampleMean = data.reduce((s, v) => s + v, 0) / n;

  return {
    mean: round(sampleMean, 4),
    lower: round(means[lowerIdx], 4),
    upper: round(means[Math.min(upperIdx, nResamples - 1)], 4),
    confidence,
    nResamples,
  };
}

/**
 * Approximate p-value for the t-distribution using the
 * regularized incomplete beta function.
 * Two-tailed test.
 */
function tDistPValue(t: number, df: number): number {
  if (t === 0) return 1.0;
  // Use the relationship between t-distribution and regularized incomplete beta
  const x = df / (df + t * t);
  const p = incompleteBeta(x, df / 2, 0.5);
  return Math.min(1, Math.max(0, p));
}

/**
 * Regularized incomplete beta function I_x(a, b)
 * using a continued fraction approximation.
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use the continued fraction representation (Lentz's algorithm)
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front =
    Math.exp(
      Math.log(x) * a + Math.log(1 - x) * b - lnBeta
    ) / a;

  // Continued fraction for I_x(a,b)
  let f = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= 200; m++) {
    // Even step
    let numerator =
      (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    // Odd step
    numerator =
      -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return front * f;
}

/**
 * Log-gamma function using Lanczos approximation.
 */
function lnGamma(z: number): number {
  const g = 7;
  const coefs = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
    );
  }

  z -= 1;
  let x = coefs[0];
  for (let i = 1; i < g + 2; i++) {
    x += coefs[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
