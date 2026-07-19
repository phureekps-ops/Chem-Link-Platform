// Section 15.1 — Composite Trust Score formula:
//   verificationScore * 30% + ratingScore * 50% + behavioralScore * 20%
// All three inputs are expected on the same 0-5 scale. Used whenever a
// CompanyRole's component scores change (verification review now; rating
// submission and RFQ-response-rate updates in later build steps).
export function computeCompositeTrustScore(
  verificationScore: number,
  ratingScore: number,
  behavioralScore: number,
): number {
  const composite = verificationScore * 0.3 + ratingScore * 0.5 + behavioralScore * 0.2;
  return Math.round(composite * 100) / 100;
}
