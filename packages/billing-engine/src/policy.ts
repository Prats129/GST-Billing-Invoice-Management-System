// Append a new version for changes to historical financial semantics.
export const CALCULATION_RULE_VERSION =
  'in-domestic-gst-2026-10-29.v1' as const;
export const CALCULATION_ENGINE_VERSION = '1.0.0' as const;
export const ROUNDING_POLICY_VERSION =
  'paise-line-half-up-balanced-components.v1' as const;
export const SUPPORTED_FROM = '2026-10-29' as const;
export const CALCULATION_POLICY = Object.freeze({
  ruleVersion: CALCULATION_RULE_VERSION,
  engineVersion: CALCULATION_ENGINE_VERSION,
  roundingPolicyVersion: ROUNDING_POLICY_VERSION,
  supportedFrom: SUPPORTED_FROM,
  sourceReviewedOn: '2026-10-29',
  professionalTaxApproval: 'pending',
  issuanceAllowed: false,
} as const);
