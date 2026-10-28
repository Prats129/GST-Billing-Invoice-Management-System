import type { Permission } from '@gst/contracts';
import type { Database, DatabaseTransaction } from '@gst/database';
export type Store = Database['db'] | DatabaseTransaction;
export interface IdentitySession {
  token: string;
  hash: string;
  id: string;
  userId: string;
  mfaVerified: boolean;
}
export interface TenantAccess {
  organizationId: string;
  membershipId: string;
  isOwner: boolean;
  permissions: Permission[];
  delegable: Permission[];
}
