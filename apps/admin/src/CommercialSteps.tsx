import type { Detail } from './types.js';
import { money } from './api.js';
export function CommercialSteps({ detail }: { detail: Detail }) {
  const base = '#/organizations/' + detail.organization.id;
  return (
    <details className="card commercial-steps">
      <summary>
        Commercial workflow · terms → receipts → licensed access
      </summary>
      <ol>
        <li>
          <a href={base + '/subscription'}>Review agreed terms</a>
          <p>
            {detail.commercialSummary
              ? `${detail.commercialSummary.agreementCount} active agreement(s) recorded.`
              : 'Refresh to load the complete agreement summary.'}{' '}
            A free trial need not have a payment agreement.
          </p>
        </li>
        <li>
          <a href={base + '/payments'}>Record money actually received</a>
          <p>
            Outstanding recorded balance:{' '}
            <strong>
              {detail.commercialSummary
                ? money(detail.commercialSummary.outstandingPaise)
                : 'Not verified'}
            </strong>
            . Partial receipts reduce the balance. Use linked
            adjustments/void-and-replacement to preserve history; do not delete
            financial records.
          </p>
        </li>
        <li>
          <a href={base + '/licenses'}>
            Prepare, sign externally and import the license
          </a>
          <p>
            Payments do not sign, install or revoke a license. The authoritative
            publisher register decides the signing sequence.
          </p>
        </li>
        <li>
          <a href={base + '/activity'}>Check application or delivery</a>
          <p>
            {detail.organization.edition === 'offline'
              ? 'Download for manual installation. Delivery and operator confirmation are separate; there is no live activation status.'
              : 'Apply the verified grant explicitly, then inspect its operation and verify hosted status. Imported grants alone do not activate access.'}
          </p>
        </li>
      </ol>
    </details>
  );
}
