// Shared structural probes. Application startup always requires the current
// entitlement table; only verified retained Phase 5 recovery omits that probe.
export async function assertDatabaseReadiness(
  query: (sql: string) => Promise<{ rows: { owner_guard?: unknown }[] }>,
  entitlements = true,
): Promise<void> {
  await query(
    'SELECT id, name, status, created_at FROM public.organizations LIMIT 0',
  );
  await query(
    'SELECT u.id, m.organization_id, s.token_hash FROM public.users u LEFT JOIN public.organization_memberships m ON m.user_id=u.id LEFT JOIN public.sessions s ON s.user_id=u.id LIMIT 0',
  );
  const guard = await query(
    "SELECT to_regprocedure('public.require_active_owner(uuid)') AS owner_guard",
  );
  if (!guard.rows[0]?.owner_guard)
    throw new Error('Security migration missing');
  await query(
    'SELECT p.organization_id, r.gstin FROM public.business_profiles p LEFT JOIN public.gst_registrations r ON r.organization_id=p.organization_id LIMIT 0',
  );
  await query(
    'SELECT c.id, t.gst_percent, v.reference FROM public.catalog_items c LEFT JOIN public.catalog_tax_revisions t ON t.organization_id=c.organization_id AND t.item_id=c.id LEFT JOIN public.catalog_tax_reviews v ON v.organization_id=t.organization_id AND v.revision_id=t.id LIMIT 0',
  );
  await query('SELECT id, version, archived_at FROM public.customers LIMIT 0');
  await query(
    'SELECT i.id, i.correction, s.digest, c.reason FROM public.invoices i LEFT JOIN public.invoice_snapshots s ON s.organization_id=i.organization_id AND s.invoice_id=i.id LEFT JOIN public.invoice_cancellations c ON c.organization_id=i.organization_id AND c.invoice_id=i.id LIMIT 0',
  );
  if (entitlements)
    await query(
      'SELECT organization_id, highest_sequence, last_observed_at FROM public.organization_entitlements LIMIT 0',
    );
}
