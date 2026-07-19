import { computeCompositeTrustScore } from './trust-score';

describe('computeCompositeTrustScore', () => {
  it('applies the 30/50/20 weighting from Section 15.1', () => {
    // 5*0.3 + 4*0.5 + 3*0.2 = 1.5 + 2 + 0.6 = 4.1
    expect(computeCompositeTrustScore(5, 4, 3)).toBe(4.1);
  });

  it('returns 0 when all components are 0', () => {
    expect(computeCompositeTrustScore(0, 0, 0)).toBe(0);
  });

  it('rounds to 2 decimal places', () => {
    // 4.7*0.3 + 3.9*0.5 + 4.2*0.2 = 1.41 + 1.95 + 0.84 = 4.2
    expect(computeCompositeTrustScore(4.7, 3.9, 4.2)).toBe(4.2);
  });
});
