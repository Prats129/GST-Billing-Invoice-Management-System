import type { PlatformOrganizationView } from '@gst/contracts/platform';
import type { EntitlementClaims, SignedEntitlement } from '@gst/contracts';
export interface Agreement {
  id: string;
  kind: string;
  total_paise: string;
  paid_paise: string;
  state: string;
  version: number;
  starts_at: string;
  ends_at: string | null;
}
export interface Receipt {
  id: string;
  agreement_id: string;
  amount_paise: string;
  reference: string;
}
export interface Grant {
  id: string;
  sequence: number;
  claims: EntitlementClaims;
  envelope: SignedEntitlement;
}
export interface LicenseRequest {
  id: string;
  claims: EntitlementClaims;
  predecessor: SignedEntitlement | null;
}
export interface Operation {
  id: string;
  kind: string;
  state: string;
  error_code: string | null;
  result: unknown;
  created_at: string;
  organization_id?: string;
  attempts?: number;
  completed_at?: string | null;
}
export interface Detail {
  commercialSummary?: { agreementCount: number; outstandingPaise: string };
  observation: Record<string, unknown> | null;
  organization: PlatformOrganizationView;
  agreements: Agreement[];
  receipts: Receipt[];
  grants: Grant[];
  requests: LicenseRequest[];
  operations: Operation[];
  activity: Record<string, unknown>[];
  delivery: Record<string, unknown>[];
  adjustments: Record<string, unknown>[];
}
