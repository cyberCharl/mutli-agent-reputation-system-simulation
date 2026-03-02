import {
  correctPValues,
  familyWiseErrorRate,
} from '../src/stats';

describe('multiple comparison correction', () => {
  test('applies Bonferroni correction', () => {
    expect(correctPValues([0.01, 0.03, 0.2], 'bonferroni')).toEqual([
      0.03,
      0.09,
      0.6,
    ]);
  });

  test('applies Holm step-down correction', () => {
    expect(correctPValues([0.01, 0.03, 0.04], 'holm')).toEqual([
      0.03,
      0.06,
      0.06,
    ]);
  });

  test('applies Benjamini-Hochberg correction', () => {
    expect(correctPValues([0.01, 0.03, 0.04], 'benjamini-hochberg')).toEqual([
      0.03,
      0.04,
      0.04,
    ]);
  });

  test('preserves values when correction is disabled', () => {
    expect(correctPValues([0.01, 0.03, 0.2], 'none')).toEqual([
      0.01,
      0.03,
      0.2,
    ]);
  });

  test('computes family-wise error rate', () => {
    expect(familyWiseErrorRate([0.01, 0.03, 0.2])).toBe(0.23176);
  });

  test('rejects invalid p-values', () => {
    expect(() => correctPValues([1.2], 'holm')).toThrow(
      'P-values must be between 0 and 1'
    );
  });
});
