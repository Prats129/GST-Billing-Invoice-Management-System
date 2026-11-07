import { createContext, useContext } from 'react';
import { billingLinks, billingRecovery } from './error-guidance.js';
import type { BillingRecovery } from './error-guidance.js';
import type { Permission } from '@gst/contracts';
export const ErrorRecoveryContext = createContext<{
  message: string;
  code: string;
  busy: boolean;
  permissions: Permission[];
  onAction: (action: BillingRecovery) => void;
} | null>(null);
export function ErrorRecoveryActions({ message }: { message: string }) {
  const context = useContext(ErrorRecoveryContext);
  if (!context || message !== context.message) return null;
  const action = billingRecovery(context.code),
    availableLinks = billingLinks(context.code),
    links = availableLinks.filter((link) =>
      context.permissions.some(
        (permission) =>
          (permission.endsWith('.read') || permission.endsWith('.manage')) &&
          permission.startsWith(
            link.href.includes('catalog') ? 'catalog.' : 'customers.',
          ),
      ),
    );
  const allowed =
    action?.action !== 'setup' ||
    context.permissions.includes('organization.manage');
  if (action && !allowed)
    return (
      <small>
        Ask an organization owner or business administrator to update Business
        setup.
      </small>
    );
  if (!links.length && availableLinks.length)
    return (
      <small>
        Ask a team member with access to the relevant customer or catalog record
        to make this correction.
      </small>
    );
  if (!action && !links.length) return null;
  return (
    <span className="recovery-actions">
      {action && allowed && (
        <button
          type="button"
          className="button button-secondary"
          disabled={context.busy}
          onClick={() => context.onAction(action.action)}
        >
          {action.label}
        </button>
      )}
      {links.map((link) => (
        <a
          className="button button-secondary"
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      ))}
    </span>
  );
}
