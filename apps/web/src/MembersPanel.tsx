import { useState } from 'react';
import type { MemberView, OrganizationAccess, RoleView } from '@gst/contracts';
import {
  formText,
  formValues,
  PasswordFields,
  RoleSelection,
} from './security-forms.js';
import type { Mutate, RunAction } from './security-forms.js';
import {
  Avatar,
  Badge,
  Dialog,
  EmptyState,
  Icon,
  Pagination,
  PermissionList,
} from './ui.js';
interface Props {
  members: MemberView[];
  roles: RoleView[];
  access: OrganizationAccess['access'];
  basePath: string;
  currentUserId: string;
  busy: boolean;
  run: RunAction;
  mutate: Mutate;
  reload: () => Promise<void>;
  offset: number;
  setOffset: (value: number) => void;
  error: string;
  onClearError: () => void;
}
export function MembersPanel({
  members,
  roles,
  access,
  basePath,
  currentUserId,
  busy,
  run,
  mutate,
  reload,
  offset,
  setOffset,
  error,
  onClearError,
}: Props) {
  const [editing, setEditing] = useState<MemberView | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const canRead = access.permissions.includes('members.read');
  const canManage = access.permissions.includes('members.manage');
  const close = () => {
    setEditing(null);
    setAdding(false);
    onClearError();
  };
  const visible = members.filter((member) =>
    `${member.name} ${member.email}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const perform = (action: () => Promise<void>) =>
    void run(async () => {
      await action();
      await reload();
      close();
    });
  return (
    <>
      <section className="surface directory">
        <div className="section-heading">
          <div>
            <h2>Team directory</h2>
            <p>Manage people and their access to this organization.</p>
          </div>
          {canManage && (
            <button
              className="button button-primary"
              onClick={() => {
                onClearError();
                setAdding(true);
              }}
            >
              <Icon name="plus" size={18} />
              Add member
            </button>
          )}
        </div>
        {canRead ? (
          <>
            <div className="table-toolbar">
              <label className="search-field">
                <Icon name="search" size={18} />
                <input
                  aria-label="Search members on this page"
                  placeholder="Search name or email on this page"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <span className="muted">{members.length} on this page</span>
            </div>
            {visible.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Assigned roles</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <div className="person">
                            <Avatar name={member.name} />
                            <div>
                              <strong>
                                {member.name}
                                {member.userId === currentUserId && (
                                  <span className="you-label">You</span>
                                )}
                              </strong>
                              <small>{member.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="badge-wrap">
                            {member.isOwner && <Badge tone="blue">Owner</Badge>}
                            {member.roleIds.map((id) => (
                              <Badge key={id}>
                                {roles.find((role) => role.id === id)?.name ??
                                  'Assigned role'}
                              </Badge>
                            ))}
                            {!member.isOwner && !member.roleIds.length && (
                              <span className="muted">No roles assigned</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <Badge
                            tone={
                              member.status === 'active'
                                ? 'green'
                                : member.status === 'invited'
                                  ? 'amber'
                                  : 'neutral'
                            }
                          >
                            {member.status === 'active'
                              ? 'Active'
                              : member.status === 'invited'
                                ? 'Invited'
                                : 'Suspended'}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="button button-secondary button-small"
                            onClick={() => {
                              onClearError();
                              setEditing(member);
                            }}
                          >
                            {canManage ? 'Manage' : 'View access'}
                            <Icon name="chevron" size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={query ? 'No matching members' : 'Your team starts here'}
              >
                {query
                  ? 'Try another name or email address.'
                  : 'Add your first team member to get started.'}
              </EmptyState>
            )}
            <Pagination
              offset={offset}
              count={members.length}
              name="members"
              onChange={(next) => {
                setQuery('');
                setOffset(next);
              }}
            />
          </>
        ) : (
          <EmptyState icon="lock" title="Directory access is restricted">
            You can add members with your current permissions.
          </EmptyState>
        )}
      </section>
      {adding && (
        <Dialog
          title="Add a team member"
          description="Give someone access to your organization."
          onClose={close}
          busy={busy}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={(event) => {
              const data = formValues(event);
              perform(async () => {
                await mutate(`${basePath}/members`, {
                  name: formText(data, 'name'),
                  email: formText(data, 'email'),
                  ...(formText(data, 'newPassword')
                    ? { temporaryPassword: formText(data, 'newPassword') }
                    : {}),
                  roleIds: data.getAll('roleIds'),
                });
              });
            }}
          >
            <div className="form-grid">
              <label>
                Name
                <input
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Full name"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  placeholder="colleague@business.com"
                />
              </label>
            </div>
            <div className="info-note">
              <Icon name="info" size={18} />
              <p>
                New account? Set a temporary password and share it privately.
                For an existing account, leave it blank to send an invitation.
              </p>
            </div>
            <PasswordFields temporary />
            <RoleSelection roles={roles} />
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="button button-primary" disabled={busy}>
                Add member
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {editing && (
        <Dialog
          title={`${canManage ? 'Manage' : 'Access for'} ${editing.name}`}
          description={editing.email}
          onClose={close}
          busy={busy}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {canManage ? (
            <>
              <form
                onSubmit={(event) => {
                  const data = formValues(event);
                  perform(async () => {
                    await mutate(
                      `${basePath}/members/${editing.id}`,
                      {
                        ...(editing.acceptedAt
                          ? { status: formText(data, 'status') }
                          : {}),
                        roleIds: data.getAll('roleIds'),
                      },
                      'PUT',
                    );
                  });
                }}
              >
                {editing.acceptedAt ? (
                  <div className="status-field">
                    <label htmlFor="membership-status">Status</label>
                    <select
                      id="membership-status"
                      name="status"
                      defaultValue={editing.status}
                    >
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                ) : (
                  <p className="info-note">
                    This invitation has not been accepted. Remove and invite
                    again to replace it.
                  </p>
                )}
                <RoleSelection roles={roles} selected={editing.roleIds} />
                <div className="dialog-actions">
                  <button className="button button-primary" disabled={busy}>
                    Save membership
                  </button>
                </div>
              </form>
              <details className="advanced-actions">
                <summary>Additional member actions</summary>
                {access.isOwner && editing.status === 'active' && (
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          editing.isOwner
                            ? 'Remove owner authority? At least one active owner must remain.'
                            : 'Grant full owner authority to this member?',
                        )
                      )
                        perform(async () => {
                          await mutate(
                            `${basePath}/members/${editing.id}/owner`,
                            { isOwner: !editing.isOwner },
                            'PUT',
                          );
                        });
                    }}
                  >
                    {editing.isOwner ? 'Remove owner authority' : 'Make owner'}
                  </button>
                )}
                {!editing.isOwner && editing.userId !== currentUserId && (
                  <form
                    onSubmit={(event) => {
                      const data = formValues(event);
                      perform(async () => {
                        await mutate(
                          `${basePath}/members/${editing.id}/password`,
                          { temporaryPassword: formText(data, 'newPassword') },
                        );
                      });
                    }}
                  >
                    <h3>Reset employee password</h3>
                    <p>
                      Unavailable for accounts shared with another organization.
                    </p>
                    <PasswordFields />
                    <button className="button button-secondary" disabled={busy}>
                      Reset password
                    </button>
                  </form>
                )}
                <div className="danger-zone">
                  <h3>Remove membership</h3>
                  <p>
                    The account and historical audit records will be preserved.
                  </p>
                  <button
                    className="button button-danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Remove this membership? Their account and historical audit records will be preserved.',
                        )
                      )
                        perform(async () => {
                          await mutate(
                            `${basePath}/members/${editing.id}`,
                            undefined,
                            'DELETE',
                          );
                        });
                    }}
                  >
                    Remove membership
                  </button>
                </div>
              </details>
            </>
          ) : (
            <PermissionList permissions={editing.effectivePermissions} />
          )}
        </Dialog>
      )}
    </>
  );
}
