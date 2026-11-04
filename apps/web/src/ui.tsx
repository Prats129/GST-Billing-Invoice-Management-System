import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Permission } from '@gst/contracts';

const paths = {
  invoice: 'M6 3h9l4 4v14H5V3Zm8 0v5h5M8 12h8M8 16h5',
  catalog: 'm12 3 9 5v10l-9 4-9-4V8Zm0 9 9-4M3 8l9 4v10M7.5 5.5l9 4',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M17 3a4 4 0 0 1 0 8m5 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7ZM8 12l3 3 5-6',
  roles: 'm12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  server: 'M4 3h16v7H4Zm0 11h16v7H4ZM8 6.5h.01M8 17.5h.01',
  logout: 'M9 21H4V3h5m5 4 5 5-5 5m-5-5h12',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  more: 'M6 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0m7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m7 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0',
  search: 'M21 21l-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  close: 'm6 6 12 12M6 18 18 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  building: 'M4 21V3h12v18M2 21h20M16 9h4v12M8 7h4M8 11h4M8 15h4M9 21v-3h2v3',
  lock: 'M5 10h14v11H5Zm3 0V6a4 4 0 0 1 8 0v4m-4 5v2',
  refresh:
    'M20 7v5h-5M4 17v-5h5m-3-5a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2',
  check: 'm5 12 4 4L19 6',
  mail: 'M3 5h18v14H3Zm0 0 9 8 9-8',
  monitor: 'M3 3h18v13H3Zm5 18h8m-4-5v5',
  key: 'm15 7 6-4m-3 2 3 3M3 15a5 5 0 1 0 10 0 5 5 0 0 0-10 0m9-3 4-4',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z',
  info: 'M12 10v7m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Icon name="building" size={23} />
      </span>
      <span>
        GST Billing<small>Business workspace</small>
      </span>
    </div>
  );
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <span
      className={`avatar${small ? ' avatar-small' : ''}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'blue';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function EmptyState({
  icon = 'users',
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export const permissionText: Record<
  Permission,
  { label: string; description: string }
> = {
  'invoices.read': {
    label: 'View invoices',
    description: 'View invoice drafts, calculations and historical copies.',
  },
  'invoices.manage': {
    label: 'Manage invoice drafts',
    description: 'Create and edit invoice drafts.',
  },
  'invoices.finalize': {
    label: 'Finalize invoices',
    description: 'Issue immutable documents when compliance gates allow.',
  },
  'invoices.correct': {
    label: 'Create correction notes',
    description: 'Create and edit linked credit/debit note drafts.',
  },
  'invoices.cancel': {
    label: 'Cancel documents',
    description:
      'Discard drafts or cancel unreported documents when release gates allow.',
  },
  'price.override': {
    label: 'Override prices',
    description: 'Override catalog prices with a recorded reason.',
  },
  'tax.override': {
    label: 'Override tax treatment',
    description:
      'Override reviewed tax classifications with a reason and source.',
  },
  'place_of_supply.override': {
    label: 'Override place of supply',
    description: 'Override guided supply location with a recorded reason.',
  },
  'organization.read': {
    label: 'View organization',
    description: 'Open the organization workspace and view its details.',
  },
  'organization.manage': {
    label: 'Manage organization',
    description: 'Manage organization-level settings when available.',
  },
  'members.read': {
    label: 'View members',
    description: 'View the team directory and assigned access.',
  },
  'members.manage': {
    label: 'Manage members',
    description: 'Add members and manage permitted access and password resets.',
  },
  'roles.read': {
    label: 'View roles',
    description: 'View the roles and permissions in this organization.',
  },
  'roles.manage': {
    label: 'Manage roles',
    description: 'Create and edit roles within your granted authority.',
  },
  'audit.read': {
    label: 'View activity log',
    description: 'Read security and access changes for the organization.',
  },
  'customers.read': {
    label: 'View customers',
    description: 'View customer details and addresses.',
  },
  'customers.manage': {
    label: 'Manage customers',
    description: 'Create, edit, archive and restore customers.',
  },
  'catalog.read': {
    label: 'View catalog',
    description: 'View products, services, prices and classification history.',
  },
  'catalog.manage': {
    label: 'Manage catalog',
    description: 'Create, edit, archive and restore products and services.',
  },
  'catalog.tax.verify': {
    label: 'Review tax classifications',
    description: 'Record a review of saved HSN/SAC and GST classifications.',
  },
};
export const permissionGroups: { name: string; keys: Permission[] }[] = [
  {
    name: 'Billing',
    keys: [
      'invoices.read',
      'invoices.manage',
      'invoices.finalize',
      'invoices.correct',
      'invoices.cancel',
      'price.override',
      'tax.override',
      'place_of_supply.override',
    ],
  },
  {
    name: 'Customers & catalog',
    keys: [
      'customers.read',
      'customers.manage',
      'catalog.read',
      'catalog.manage',
      'catalog.tax.verify',
    ],
  },
  { name: 'Organization', keys: ['organization.read', 'organization.manage'] },
  { name: 'Team', keys: ['members.read', 'members.manage'] },
  {
    name: 'Roles & activity',
    keys: ['roles.read', 'roles.manage', 'audit.read'],
  },
];
export function PermissionList({ permissions }: { permissions: Permission[] }) {
  return permissions.length ? (
    <ul className="permission-list">
      {permissions.map((permission) => (
        <li key={permission}>
          <Icon name="check" size={16} />
          {permissionText[permission].label}
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">No active permissions.</p>
  );
}
let openDialogCount = 0;
let previousDocumentOverflow = '';
export function Dialog({
  title,
  description,
  children,
  onClose,
  busy = false,
  wide = false,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement;
    if (!node) return;
    node.showModal();
    if (openDialogCount++ === 0) {
      previousDocumentOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    node
      .querySelector<HTMLElement>(
        'input:not([type="checkbox"]):not([type="hidden"])',
      )
      ?.focus();
    return () => {
      node.close();
      if (--openDialogCount === 0)
        document.documentElement.style.overflow = previousDocumentOverflow;
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' dialog-wide' : ''} ${className}`}
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2 id={id}>{title}</h2>
          {description && <p id={`${id}-description`}>{description}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Pagination({
  offset,
  count,
  name,
  onChange,
}: {
  offset: number;
  count: number;
  name: string;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {count ? `${offset + 1}–${offset + count}` : '0'} shown · up to 50 per
        page
      </span>
      <div>
        <button
          className="button button-quiet"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - 50))}
          aria-label={`Previous ${name}`}
        >
          <Icon name="chevron" size={16} />
          Previous
        </button>
        <button
          className="button button-quiet"
          disabled={count < 50}
          onClick={() => onChange(offset + 50)}
          aria-label={`Next ${name}`}
        >
          Next
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </div>
  );
}
export function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
