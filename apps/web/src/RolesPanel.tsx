import { useState } from 'react';
import type { OrganizationAccess, Permission, RoleView } from '@gst/contracts';
import { formText, formValues } from './security-forms.js';
import type { Mutate, RunAction } from './security-forms.js';
import {
  Badge,
  Dialog,
  EmptyState,
  Icon,
  Pagination,
  PermissionList,
  permissionGroups,
  permissionText,
} from './ui.js';
interface Props {
  roles: RoleView[];
  access: OrganizationAccess['access'];
  basePath: string;
  busy: boolean;
  run: RunAction;
  mutate: Mutate;
  reload: () => Promise<void>;
  offset: number;
  setOffset: (value: number) => void;
  error: string;
  onClearError: () => void;
}
export function RolesPanel({
  roles,
  access,
  basePath,
  busy,
  run,
  mutate,
  reload,
  offset,
  setOffset,
  error,
  onClearError,
}: Props) {
  const [editing, setEditing] = useState<RoleView | null | undefined>();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [delegable, setDelegable] = useState<Permission[]>([]);
  const canManage = access.permissions.includes('roles.manage');
  const editable = (role: RoleView) =>
    canManage &&
    !role.system &&
    (access.isOwner ||
      (!role.delegable.length &&
        role.permissions.every((key) => access.delegable.includes(key))));
  const open = (role: RoleView | null) => {
    onClearError();
    setEditing(role);
    setPermissions(role?.permissions ?? []);
    setDelegable(role?.delegable ?? []);
  };
  const close = () => {
    setEditing(undefined);
    onClearError();
  };
  const readOnly = Boolean(editing && !editable(editing));
  return (
    <>
      <div className="section-heading roles-heading">
        <div>
          <h2>Access roles</h2>
          <p>Reusable permissions for the way your team works.</p>
        </div>
        {canManage && (
          <button className="button button-primary" onClick={() => open(null)}>
            <Icon name="plus" size={18} />
            Create role
          </button>
        )}
      </div>
      {access.permissions.includes('roles.read') && (
        <>
          {roles.length ? (
            <div className="role-grid">
              {roles.map((role) => (
                <section className="surface role-card" key={role.id}>
                  <div className="role-card-top">
                    <span
                      className={`feature-icon ${role.system ? 'blue' : ''}`}
                    >
                      <Icon name="roles" />
                    </span>
                    <Badge tone={role.system ? 'blue' : 'neutral'}>
                      {role.system ? 'Built-in' : 'Custom'}
                    </Badge>
                  </div>
                  <h2>{role.name}</h2>
                  <p>
                    {role.permissions.length}{' '}
                    {role.permissions.length === 1
                      ? 'permission'
                      : 'permissions'}
                    {role.delegable.length
                      ? ` · ${role.delegable.length} shareable`
                      : ''}
                  </p>
                  <PermissionList permissions={role.permissions} />
                  <div className="card-footer">
                    <span className="muted">
                      {role.system
                        ? 'Protected starter role'
                        : 'Organization role'}
                    </span>
                    <button
                      className="button button-quiet"
                      onClick={() => open(role)}
                    >
                      {editable(role) ? 'Edit role' : 'View role'}
                      <Icon
                        name={editable(role) ? 'edit' : 'arrow'}
                        size={15}
                      />
                    </button>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="surface">
              <EmptyState icon="roles" title="No roles yet">
                Create a role to define the access your team needs.
              </EmptyState>
            </section>
          )}
          <Pagination
            offset={offset}
            count={roles.length}
            name="roles"
            onChange={setOffset}
          />
        </>
      )}
      <div className="info-note roles-note">
        <Icon name="shield" size={20} />
        <p>
          <strong>Keep access intentional.</strong> Built-in roles are
          protected. Custom roles let you choose precisely what a team member
          can do.
        </p>
      </div>
      {editing !== undefined && (
        <Dialog
          title={
            readOnly
              ? (editing?.name ?? 'Role details')
              : editing
                ? 'Edit role'
                : 'Create a role'
          }
          description={
            readOnly
              ? 'Review the permissions in this role.'
              : 'Choose a clear name and the access this role should provide.'
          }
          onClose={close}
          busy={busy}
          wide
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {readOnly ? (
            <PermissionList permissions={editing?.permissions ?? []} />
          ) : (
            <form
              onSubmit={(event) => {
                const data = formValues(event);
                void run(async () => {
                  await mutate(
                    `${basePath}/roles${editing ? `/${editing.id}` : ''}`,
                    { name: formText(data, 'name'), permissions, delegable },
                    editing ? 'PUT' : 'POST',
                  );
                  await reload();
                  close();
                });
              }}
            >
              <label>
                Role name
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={editing?.name ?? ''}
                  placeholder="e.g. Office manager"
                />
              </label>
              <div className="permission-editor">
                {permissionGroups.map((group) => (
                  <fieldset key={group.name}>
                    <legend>{group.name}</legend>
                    {group.keys.map((key) => (
                      <div className="permission-option" key={key}>
                        <label className="check">
                          <input
                            type="checkbox"
                            name="permissions"
                            value={key}
                            checked={permissions.includes(key)}
                            disabled={
                              !access.isOwner && !access.delegable.includes(key)
                            }
                            onChange={(event) => {
                              setPermissions((previous) =>
                                event.target.checked
                                  ? [...previous, key]
                                  : previous.filter((item) => item !== key),
                              );
                              if (!event.target.checked)
                                setDelegable((previous) =>
                                  previous.filter((item) => item !== key),
                                );
                            }}
                          />
                          <span>
                            <strong>{permissionText[key].label}</strong>
                            <small>{permissionText[key].description}</small>
                          </span>
                        </label>
                        {access.isOwner && (
                          <label className="check delegated">
                            <input
                              type="checkbox"
                              checked={delegable.includes(key)}
                              disabled={!permissions.includes(key)}
                              onChange={(event) =>
                                setDelegable((previous) =>
                                  event.target.checked
                                    ? [...previous, key]
                                    : previous.filter((item) => item !== key),
                                )
                              }
                            />
                            Allow holders to share this permission
                          </label>
                        )}
                      </div>
                    ))}
                  </fieldset>
                ))}
              </div>
              <div className="dialog-actions">
                {editing && (
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Delete this role and revoke its assignments?',
                        )
                      )
                        void run(async () => {
                          await mutate(
                            `${basePath}/roles/${editing.id}`,
                            undefined,
                            'DELETE',
                          );
                          await reload();
                          close();
                        });
                    }}
                  >
                    Delete role
                  </button>
                )}
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={busy}>
                  Save role
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
