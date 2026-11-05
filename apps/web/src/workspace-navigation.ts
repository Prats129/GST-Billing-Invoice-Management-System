import type { Permission } from '@gst/contracts';
import type { IconName } from './ui.js';

export const viewInfo = {
  overview: {
    title: 'Workspace overview',
    description: 'Your daily work, with a clear place for every task.',
    icon: 'home',
  },
  invoices: {
    title: 'Invoices',
    description:
      'Create drafts, review totals and prepare your billing documents.',
    icon: 'invoice',
  },
  customers: {
    title: 'Customers',
    description: 'Customer contacts, addresses and billing details.',
    icon: 'users',
  },
  catalog: {
    title: 'Catalog',
    description: 'Products, services, pricing and tax classifications.',
    icon: 'catalog',
  },
  business: {
    title: 'Business setup',
    description:
      'Business identity, GST registration and invoice bank details.',
    icon: 'building',
  },
  members: {
    title: 'Members',
    description: 'Invite your team and manage their organization access.',
    icon: 'users',
  },
  roles: {
    title: 'Roles & permissions',
    description: 'Define what each role can view and manage.',
    icon: 'roles',
  },
  activity: {
    title: 'Activity log',
    description: 'Review security and access changes in your organization.',
    icon: 'activity',
  },
  security: {
    title: 'Account security',
    description: 'Your password, two-step verification and active sessions.',
    icon: 'shield',
  },
  system: {
    title: 'System status',
    description: 'Connection details and service availability.',
    icon: 'server',
  },
} satisfies Record<
  string,
  { title: string; description: string; icon: IconName }
>;
export type View = keyof typeof viewInfo;
export function currentView(): View {
  const value = window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return Object.hasOwn(viewInfo, value) ? (value as View) : 'overview';
}
export function currentRoute(): string {
  const view = currentView();
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  return ['invoices', 'customers', 'catalog'].includes(view) && parts.length > 1
    ? `${view}/${parts.slice(1).join('/')}`
    : view;
}
export const businessViews: View[] = [
  'business',
  'members',
  'roles',
  'activity',
];
export const primaryViews: View[] = [
  'overview',
  'invoices',
  'customers',
  'catalog',
];
export function canOpenView(view: View, permissions: readonly Permission[]) {
  switch (view) {
    case 'invoices':
      return permissions.includes('invoices.read');
    case 'customers':
      return permissions.some(
        (p) => p === 'customers.read' || p === 'customers.manage',
      );
    case 'catalog':
      return permissions.some(
        (p) => p === 'catalog.read' || p === 'catalog.manage',
      );
    case 'business':
      return permissions.some(
        (p) => p === 'organization.read' || p === 'organization.manage',
      );
    case 'members':
      return permissions.some(
        (p) => p === 'members.read' || p === 'members.manage',
      );
    case 'roles':
      return permissions.some(
        (p) => p === 'roles.read' || p === 'roles.manage',
      );
    case 'activity':
      return permissions.includes('audit.read');
    default:
      return true;
  }
}
