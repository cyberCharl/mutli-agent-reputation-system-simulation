import { CorrectionMethod } from '../types';

export function correctPValues(
  pValues: number[],
  method: CorrectionMethod
): number[] {
  validatePValues(pValues);

  if (method === 'none') {
    return pValues.map((value) => round(clamp01(value), 6));
  }

  if (method === 'bonferroni') {
    return pValues.map((value) => round(clamp01(value * pValues.length), 6));
  }

  const indexed = pValues
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);

  const adjusted = new Array<number>(pValues.length);

  if (method === 'holm') {
    let runningMax = 0;
    indexed.forEach(({ value, index }, orderIndex) => {
      const adjustedValue = clamp01((pValues.length - orderIndex) * value);
      runningMax = Math.max(runningMax, adjustedValue);
      adjusted[index] = round(runningMax, 6);
    });
    return adjusted;
  }

  if (method === 'benjamini-hochberg') {
    let runningMin = 1;
    for (let orderIndex = indexed.length - 1; orderIndex >= 0; orderIndex--) {
      const { value, index } = indexed[orderIndex];
      const rank = orderIndex + 1;
      const adjustedValue = clamp01((pValues.length / rank) * value);
      runningMin = Math.min(runningMin, adjustedValue);
      adjusted[index] = round(runningMin, 6);
    }
    return adjusted;
  }

  throw new Error(`Unsupported correction method: ${method}`);
}

export function familyWiseErrorRate(pValues: number[]): number {
  validatePValues(pValues);
  const product = pValues.reduce((accumulator, value) => {
    return accumulator * (1 - clamp01(value));
  }, 1);
  return round(1 - product, 6);
}

function validatePValues(pValues: number[]): void {
  pValues.forEach((value) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('P-values must be between 0 and 1');
    }
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
