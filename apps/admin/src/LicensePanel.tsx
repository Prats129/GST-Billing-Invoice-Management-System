import type { Detail } from './types.js';
import { Form, Field, Table } from './components.js';
import { api, requestKey, money, download } from './api.js';
import { value, iso, now } from './forms.js';
export function LicensePanel({
  detail,
  busy,
  mark,
  save,
  run,
}: {
  detail: Detail;
  busy: boolean;
  mark: (v: boolean) => void;
  save: (p: string, b: unknown) => Promise<unknown>;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
}) {
  const org = detail.organization,
    base = 'organizations/' + org.id,
    latest = detail.grants[0];
  const balance = detail.agreements
    .filter((a) => a.state === 'active')
    .reduce((sum, a) => sum + BigInt(a.total_paise) - BigInt(a.paid_paise), 0n)
    .toString();
  return (
    <>
      <section className="card">
        <h2>Signed grants</h2>
        <p>
          Outstanding agreed balance: <strong>{money(balance)}</strong>.
          Payments and access approval are separate.
        </p>
        <p>
          Import does not mean installed. Offline confirmation is an operator
          report, not live verification.
        </p>
        {detail.grants.map((g) => (
          <div className="grant" key={g.id}>
            <strong>
              Sequence {g.sequence} · {g.claims.kind}
            </strong>
            <span>
              Valid {g.claims.startsAt} → {g.claims.expiresAt ?? 'perpetual'}
            </span>
            <span>Maintenance: {g.claims.maintenanceUntil ?? 'none'}</span>
            <button
              onClick={() =>
                download('signed-grant-' + g.sequence + '.json', g.envelope)
              }
            >
              Download signed grant
            </button>
            {org.edition === 'saas' && g.id === latest?.id && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    !confirm(
                      'Apply sequence ' +
                        g.sequence +
                        ' now? It replaces the current grant. Starts ' +
                        g.claims.startsAt +
                        '; expires ' +
                        (g.claims.expiresAt ?? 'never') +
                        '. A future or expired grant makes business changes read-only.',
                    )
                  )
                    return;
                  void save(base + '/apply', {
                    grantId: g.id,
                    requestKey: requestKey(),
                  }).catch(() => {});
                }}
              >
                Apply approved grant
              </button>
            )}
          </div>
        ))}
        <Table rows={detail.delivery} />
      </section>
      <Form
        title="Prepare immutable signing request"
        submit="Prepare request"
        busy={busy}
        dirty={mark}
        onSave={(d) =>
          run(async () => {
            const start = iso(d, 'startsAt'),
              kind = value(d, 'kind'),
              claims = {
                version: 1,
                entitlementId: crypto.randomUUID(),
                organizationId: org.runtime_id,
                edition: org.edition,
                installationId: org.installation_id,
                sequence: (latest?.sequence ?? 0) + 1,
                issuedAt: new Date().toISOString(),
                startsAt: start,
                kind,
                expiresAt:
                  kind === 'perpetual'
                    ? null
                    : kind === 'trial'
                      ? new Date(
                          Date.parse(start) + 14 * 86400000,
                        ).toISOString()
                      : iso(d, 'expiresAt'),
                maintenanceUntil: value(d, 'maintenanceUntil')
                  ? iso(d, 'maintenanceUntil')
                  : null,
              };
            if (
              !confirm(
                'Freeze sequence ' +
                  claims.sequence +
                  ' (' +
                  claims.kind +
                  ') for ' +
                  claims.organizationId +
                  '? Starts ' +
                  claims.startsAt +
                  '; expires ' +
                  (claims.expiresAt ?? 'never') +
                  '; maintenance ' +
                  (claims.maintenanceUntil ?? 'none') +
                  '. Outstanding balance ' +
                  money(balance) +
                  '. This does not activate access.',
              )
            )
              return;
            await api(base + '/license-requests', {
              claims,
              requestKey: requestKey(),
            });
          })
        }
      >
        <p>
          Reconcile the authoritative publisher history first. Review the
          agreement balance before preparing a grant. Dates use your browser’s
          local timezone and are stored as UTC.
        </p>
        <Field label="Entitlement type" name="kind">
          <option>subscription</option>
          {!latest && <option>trial</option>}
          {org.edition === 'offline' && <option>perpetual</option>}
        </Field>
        <Field
          label="Starts at"
          name="startsAt"
          type="datetime-local"
          defaultValue={now()}
        />
        <Field
          label="Expires at (subscription only)"
          name="expiresAt"
          type="datetime-local"
          required={false}
        />
        <Field
          label="Maintenance until (optional)"
          name="maintenanceUntil"
          type="datetime-local"
          required={false}
        />
      </Form>
      <section className="card">
        <h2>Signing requests</h2>
        {detail.requests.map((r) => (
          <div className="grant" key={r.id}>
            <strong>Request {r.id}</strong>
            <span>
              Sequence {r.claims.sequence} · {r.claims.kind} ·{' '}
              {r.claims.startsAt}
            </span>
            <button
              onClick={() =>
                download('approved-claims-' + r.id + '.json', r.claims)
              }
            >
              Export claims for issuer CLI
            </button>
            {r.predecessor && (
              <button
                onClick={() => download('previous-grant.json', r.predecessor)}
              >
                Export predecessor
              </button>
            )}
          </div>
        ))}
      </section>
      <Form
        title="Import signed grant or reconcile history"
        submit="Verify and import"
        busy={busy}
        dirty={mark}
        onSave={(d) => {
          const parsed = JSON.parse(value(d, 'grants'));
          return save(base + '/grants', {
            requestId: value(d, 'requestId') || null,
            grants: Array.isArray(parsed) ? parsed : [parsed],
            requestKey: requestKey(),
          });
        }}
      >
        <Field label="Request to match" name="requestId" required={false}>
          <option value="">
            History reconciliation (complete verified chain)
          </option>
          {detail.requests.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </Field>
        <Field
          label="Signed envelope JSON (or ordered array)"
          name="grants"
          type="textarea"
        />
      </Form>
      {org.edition === 'offline' && (
        <Form
          title="Record offline handoff"
          busy={busy}
          dirty={mark}
          onSave={(d) =>
            save(base + '/delivery', {
              grantId: value(d, 'grantId'),
              state: value(d, 'state'),
              note: value(d, 'note'),
              requestKey: requestKey(),
            })
          }
        >
          <Field label="Grant" name="grantId">
            <option value="">Choose grant</option>
            {detail.grants.map((g) => (
              <option key={g.id} value={g.id}>
                Sequence {g.sequence}
              </option>
            ))}
          </Field>
          <Field label="Report" name="state">
            <option value="delivery_recorded">
              Delivery recorded; installation unverified
            </option>
            <option value="operator_confirmed">
              Installation reported by operator
            </option>
          </Field>
          <Field label="Evidence or handoff note" name="note" />
        </Form>
      )}
    </>
  );
}
