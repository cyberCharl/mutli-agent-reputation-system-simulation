import { EffectSizeInterpretation } from '../types';

const CLIFFS_THRESHOLDS = {
  negligible: 0.147,
  small: 0.33,
  medium: 0.474,
};

export function cohensD(baseline: number[], treatment: number[]): number {
  validateSamples(baseline, treatment);

  const baselineMean = mean(baseline);
  const treatmentMean = mean(treatment);
  const pooledStdDev = Math.sqrt(
    (sampleVariance(baseline, baselineMean) +
      sampleVariance(treatment, treatmentMean)) /
      2
  );

  if (pooledStdDev === 0) {
    return treatmentMean === baselineMean ? 0 : saturatingEffect(treatmentMean - baselineMean);
  }

  return round((treatmentMean - baselineMean) / pooledStdDev, 6);
}

export function glassDelta(baseline: number[], treatment: number[]): number {
  validateSamples(baseline, treatment);

  const baselineStdDev = Math.sqrt(sampleVariance(baseline));
  const difference = mean(treatment) - mean(baseline);

  if (baselineStdDev === 0) {
    return difference === 0 ? 0 : saturatingEffect(difference);
  }

  return round(difference / baselineStdDev, 6);
}

export function cliffsDelta(baseline: number[], treatment: number[]): number {
  validateSamples(baseline, treatment);

  let greater = 0;
  let lesser = 0;

  for (const base of baseline) {
    for (const treated of treatment) {
      if (treated > base) {
        greater++;
      } else if (treated < base) {
        lesser++;
      }
    }
  }

  return round((greater - lesser) / (baseline.length * treatment.length), 6);
}

export function interpretEffectSize(
  effectSize: number
): EffectSizeInterpretation {
  const magnitude = Math.abs(effectSize);
  if (magnitude < 0.2) {
    return 'negligible';
  }
  if (magnitude < 0.5) {
    return 'small';
  }
  if (magnitude < 0.8) {
    return 'medium';
  }
  return 'large';
}

export function interpretCliffsDelta(
  effectSize: number
): EffectSizeInterpretation {
  const magnitude = Math.abs(effectSize);
  if (magnitude < CLIFFS_THRESHOLDS.negligible) {
    return 'negligible';
  }
  if (magnitude < CLIFFS_THRESHOLDS.small) {
    return 'small';
  }
  if (magnitude < CLIFFS_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'large';
}

function validateSamples(baseline: number[], treatment: number[]): void {
  if (baseline.length === 0 || treatment.length === 0) {
    throw new Error('Samples must not be empty');
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: number[], knownMean: number = mean(values)): number {
  if (values.length < 2) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + (value - knownMean) ** 2, 0) /
    (values.length - 1)
  );
}

function saturatingEffect(difference: number): number {
  return difference > 0 ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
