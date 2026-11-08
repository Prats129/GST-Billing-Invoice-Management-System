import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { digest, verifyEntitlement, loadEntitlementTrust } from '@gst/security';
import type { EntitlementTrust } from '@gst/security';
import type { EntitlementClaims, SignedEntitlement } from '@gst/contracts';
import { signedEntitlementSchema } from '@gst/contracts';
import type { PlatformOrganizationView } from '@gst/contracts/platform';
import { rows, transaction, audit } from './store.js';
import type { Tx } from './store.js';
import type { AdminSession } from './auth.js';
import { lockPlatformSession } from './auth.js';
import { fail } from './errors.js';
const uuid = (s: string) => z.string().uuid().parse(s);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function successor(c: EntitlementClaims, p?: EntitlementClaims) {
  if (!p) {
    if (c.sequence !== 1) fail('HISTORY_REQUIRED');
    return;
  }
  if (
    c.sequence !== p.sequence + 1 ||
    c.organizationId !== p.organizationId ||
    c.edition !== p.edition ||
    c.installationId !== p.installationId ||
    c.kind === 'trial' ||
    c.entitlementId === p.entitlementId ||
    Date.parse(c.issuedAt) < Date.parse(p.issuedAt)
  )
    fail('GRANT_CONFLICT');
}
export class PlatformService {
  trust: EntitlementTrust = new Map();
  constructor(
    readonly db: Pool,
    trust?: unknown,
  ) {
    if (trust) this.trust = loadEntitlementTrust(trust);
  }
  async organization(tx: Pool | Tx, id: string, lock = false) {
    const [org] = await rows<PlatformOrganizationView>(
      tx,
      'SELECT * FROM platform_organizations WHERE id=$1' +
        (lock ? ' FOR UPDATE' : ''),
      [uuid(id)],
    );
    if (!org) fail('NOT_FOUND', 404);
    return org;
  }
  async mutate<T>(
    actor: AdminSession,
    action: string,
    key: string,
    input: unknown,
    orgId: string | null,
    work: (tx: Tx) => Promise<T>,
  ) {
    return transaction(this.db, async (tx) => {
      await lockPlatformSession(
        tx,
        actor,
        ['license.apply', 'writes.pause', 'setup.link'].includes(action),
      );

      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        uuid(key),
      ]);
      const hash = digest(canonical(input));
      const [old] = await rows<{ action: string; digest: string; result: T }>(
        tx,
        'SELECT * FROM platform_mutations WHERE id=$1',
        [key],
      );
      if (old) {
        if (old.action !== action || old.digest !== hash)
          fail('IDEMPOTENCY_CONFLICT');
        return old.result;
      }
      const result = await work(tx);
      await tx.query('INSERT INTO platform_mutations VALUES($1,$2,$3,$4)', [
        key,
        action,
        hash,
        JSON.stringify(result),
      ]);
      await audit(tx, actor.owner_id, action, orgId, null, { requestKey: key });
      return result;
    });
  }
  async directory(
    query: string,
    edition: string,
    state: string,
    offset: number,
  ) {
    return rows<PlatformOrganizationView>(
      this.db,
      `SELECT * FROM platform_organizations WHERE ($1='' OR name ILIKE '%'||$1||'%' OR email ILIKE '%'||$1||'%') AND ($2='' OR edition=$2) AND ($3='' OR state=$3) ORDER BY created_at DESC,id LIMIT 51 OFFSET $4`,
      [query, edition, state, offset],
    );
  }
  async overview() {
    const [o] = await rows(
      this.db,
      `SELECT count(*)::int AS organizations,count(*) FILTER(WHERE edition='offline')::int AS offline,count(*) FILTER(WHERE state='pending')::int AS pending FROM platform_organizations`,
    );
    const [balance] = await rows(
      this.db,
      `SELECT coalesce(sum(total_paise),0)-coalesce((SELECT sum(amount_paise) FROM platform_receipts),0)+coalesce((SELECT sum(amount_paise) FROM platform_adjustments),0) AS outstanding_paise FROM platform_agreements WHERE state='active'`,
    );
    const operations = await rows(
      this.db,
      "SELECT id,organization_id,kind,state,error_code,attempts,created_at,completed_at FROM platform_operations WHERE state<>'completed' ORDER BY created_at LIMIT 20",
    );
    const expiring = await rows(
      this.db,
      `SELECT DISTINCT ON (g.organization_id) g.organization_id,g.claims,o.name FROM platform_grants g JOIN platform_organizations o ON o.id=g.organization_id ORDER BY g.organization_id,g.sequence DESC`,
    );
    return {
      ...o,
      ...balance,
      operations,
      expiring: expiring.filter((g) => {
        const c = g.claims as EntitlementClaims;
        return (
          c.expiresAt && Date.parse(c.expiresAt) <= Date.now() + 30 * 86400000
        );
      }),
    };
  }
  async details(id: string) {
    const org = await this.organization(this.db, id);
    const [commercialSummary] = await rows(
      this.db,
      `SELECT count(*)::int AS "agreementCount",
       coalesce(sum(a.total_paise - coalesce((SELECT sum(r.amount_paise) FROM platform_receipts r WHERE r.agreement_id=a.id),0)
       + coalesce((SELECT sum(j.amount_paise) FROM platform_adjustments j WHERE j.agreement_id=a.id),0)),0)::text AS "outstandingPaise"
       FROM platform_agreements a WHERE a.organization_id=$1 AND a.state='active'`,
      [id],
    );
    const agreements = await rows(
      this.db,
      `SELECT a.*,coalesce((SELECT sum(amount_paise) FROM platform_receipts WHERE agreement_id=a.id),0)-coalesce((SELECT sum(amount_paise) FROM platform_adjustments WHERE agreement_id=a.id),0) AS paid_paise FROM platform_agreements a WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [id],
    );
    const receipts = await rows(
      this.db,
      'SELECT * FROM platform_receipts WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
      [id],
    );
    const adjustments = await rows(
      this.db,
      'SELECT j.* FROM platform_adjustments j JOIN platform_agreements a ON a.id=j.agreement_id WHERE a.organization_id=$1 ORDER BY j.created_at DESC LIMIT 100',
      [id],
    );
    const grants = await rows(
      this.db,
      'SELECT * FROM platform_grants WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 100',
      [id],
    );
    const requests = await rows(
      this.db,
      'SELECT * FROM platform_license_requests WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
      [id],
    );
    const delivery = await rows(
      this.db,
      'SELECT * FROM platform_delivery WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
      [id],
    );
    const activity = await rows(
      this.db,
      'SELECT * FROM platform_audit WHERE organization_id=$1 ORDER BY id DESC LIMIT 100',
      [id],
    );
    const operations = await rows(
      this.db,
      'SELECT id,kind,state,error_code,result,created_at,completed_at FROM platform_operations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
      [id],
    );
    const [observation] = await rows(
      this.db,
      'SELECT value,observed_at FROM platform_observations WHERE organization_id=$1',
      [id],
    );
    return {
      organization: org,
      commercialSummary,
      agreements,
      receipts,
      adjustments,
      grants,
      requests,
      delivery,
      activity,
      operations,
      observation: observation ?? null,
    };
  }
  async queue(tx: Tx, id: string, kind: string, payload: object) {
    const operationId = randomUUID();
    await tx.query(
      'INSERT INTO platform_operations(id,organization_id,kind,payload) VALUES($1,$2,$3,$4)',
      [operationId, id, kind, JSON.stringify(payload)],
    );
    return { operationId };
  }
  async head(tx: Pool | Tx, id: string) {
    const [g] = await rows<{
      envelope: SignedEntitlement;
      claims: EntitlementClaims;
    }>(
      tx,
      'SELECT envelope,claims FROM platform_grants WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 1',
      [id],
    );
    return g;
  }
  async licenseRequest(tx: Tx, id: string, claims: EntitlementClaims) {
    const org = await this.organization(tx, id, true);
    if (
      org.runtime_id !== claims.organizationId ||
      org.edition !== claims.edition ||
      org.installation_id !== claims.installationId
    )
      fail('WRONG_BINDING');
    const previous = await this.head(tx, id);
    successor(claims, previous?.claims);
    const requestId = randomUUID();
    await tx.query(
      'INSERT INTO platform_license_requests(id,organization_id,claims,predecessor) VALUES($1,$2,$3,$4)',
      [requestId, id, claims, previous?.envelope ?? null],
    );
    return { id: requestId, claims, predecessor: previous?.envelope ?? null };
  }
  async importGrants(
    tx: Tx,
    id: string,
    grants: SignedEntitlement[],
    requestId: string | null,
  ) {
    const org = await this.organization(tx, id, true);
    let head = await this.head(tx, id);
    for (const envelope of grants) {
      const c = verifyEntitlement(envelope, this.trust);
      if (
        c.organizationId !== org.runtime_id ||
        c.edition !== org.edition ||
        c.installationId !== org.installation_id
      )
        fail('WRONG_BINDING');
      const [existing] = await rows<{ envelope: SignedEntitlement }>(
        tx,
        'SELECT envelope FROM platform_grants WHERE organization_id=$1 AND sequence=$2',
        [id, c.sequence],
      );
      if (existing) {
        if (canonical(existing.envelope) !== canonical(envelope))
          fail('GRANT_CONFLICT');
        continue;
      }
      successor(c, head?.claims);
      if (requestId) {
        const [r] = await rows<{
          claims: EntitlementClaims;
          predecessor: SignedEntitlement | null;
        }>(
          tx,
          'SELECT claims,predecessor FROM platform_license_requests WHERE id=$1 AND organization_id=$2',
          [requestId, id],
        );
        if (
          !r ||
          canonical(r.claims) !== canonical(c) ||
          canonical(r.predecessor) !== canonical(head?.envelope ?? null)
        )
          fail('REQUEST_MISMATCH');
      }
      await tx.query(
        'INSERT INTO platform_grants(id,organization_id,sequence,envelope,claims) VALUES($1,$2,$3,$4,$5)',
        [c.entitlementId, id, c.sequence, envelope, c],
      );
      head = { envelope, claims: c };
    }
    return { sequence: head?.claims.sequence ?? 0 };
  }
  async receipt(
    tx: Tx,
    id: string,
    v: {
      agreementId: string;
      amountPaise: string;
      receivedAt: string;
      reference: string;
    },
  ) {
    const [agreement] = await rows<{ total_paise: string; state: string }>(
      tx,
      'SELECT total_paise,state FROM platform_agreements WHERE id=$1 AND organization_id=$2 FOR UPDATE',
      [v.agreementId, id],
    );
    if (!agreement || agreement.state !== 'active')
      fail('AGREEMENT_UNAVAILABLE');
    const [paid] = await rows<{ value: string }>(
      tx,
      'SELECT coalesce((SELECT sum(amount_paise) FROM platform_receipts WHERE agreement_id=$1),0)-coalesce((SELECT sum(amount_paise) FROM platform_adjustments WHERE agreement_id=$1),0) AS value',
      [v.agreementId],
    );
    if (
      BigInt(paid?.value ?? 0) + BigInt(v.amountPaise) >
      BigInt(agreement.total_paise)
    )
      fail('OVERPAYMENT');
    const receiptId = randomUUID();
    await tx.query(
      'INSERT INTO platform_receipts(id,organization_id,agreement_id,amount_paise,reference,received_at) VALUES($1,$2,$3,$4,$5,$6)',
      [receiptId, id, v.agreementId, v.amountPaise, v.reference, v.receivedAt],
    );
    return { id: receiptId };
  }
  async adjustment(
    tx: Tx,
    id: string,
    v: { receiptId: string; amountPaise: string; kind: string; reason: string },
  ) {
    const [r] = await rows<{ agreement_id: string; amount_paise: string }>(
      tx,
      'SELECT * FROM platform_receipts WHERE id=$1 AND organization_id=$2',
      [v.receiptId, id],
    );
    if (!r) fail('NOT_FOUND', 404);
    await tx.query(
      'SELECT id FROM platform_agreements WHERE id=$1 FOR UPDATE',
      [r.agreement_id],
    );
    const [sum] = await rows<{ value: string }>(
      tx,
      'SELECT coalesce(sum(amount_paise),0) AS value FROM platform_adjustments WHERE receipt_id=$1',
      [v.receiptId],
    );
    if (
      BigInt(sum?.value ?? 0) + BigInt(v.amountPaise) >
      BigInt(r.amount_paise)
    )
      fail('EXCESS_ADJUSTMENT');
    const adjustmentId = randomUUID();
    await tx.query(
      'INSERT INTO platform_adjustments(id,agreement_id,receipt_id,amount_paise,kind,reason) VALUES($1,$2,$3,$4,$5,$6)',
      [
        adjustmentId,
        r.agreement_id,
        v.receiptId,
        v.amountPaise,
        v.kind,
        v.reason,
      ],
    );
    return { id: adjustmentId };
  }
  async download(id: string, grantId: string) {
    await this.organization(this.db, id);
    const [g] = await rows<{ envelope: unknown }>(
      this.db,
      'SELECT envelope FROM platform_grants WHERE id=$1 AND organization_id=$2',
      [uuid(grantId), id],
    );
    if (!g) fail('NOT_FOUND', 404);
    const envelope = signedEntitlementSchema.parse(g.envelope);
    verifyEntitlement(envelope, this.trust);
    return envelope;
  }
}
