import type { FormEvent } from 'react';
export function OperationFilters({
  route,
  hasMore,
  busy,
}: {
  route: string;
  hasMore: boolean;
  busy: boolean;
}) {
  const params = new URLSearchParams(route.split('?')[1] ?? '');
  const offset = Number(params.get('offset') ?? '0');
  const move = (next: number) => {
    const search = new URLSearchParams(params);
    search.set('offset', String(next));
    location.hash = '/operations?' + search;
  };
  return (
    <div className="operation-filters">
      <form
        key={route}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const search = new URLSearchParams();
          for (const name of ['q', 'state', 'kind', 'organizationId'])
            search.set(name, String(data.get(name) ?? '').trim());
          location.hash = '/operations?' + search;
        }}
      >
        <fieldset disabled={busy} className="grid">
          <label>
            Operation ID
            <input
              name="q"
              defaultValue={params.get('q') ?? ''}
              maxLength={36}
              pattern={'[a-fA-F0-9\\-]*'}
              placeholder="Full ID or part of it"
            />
          </label>
          <label>
            Operation state
            <select name="state" defaultValue={params.get('state') ?? ''}>
              <option value="">All states</option>
              {['pending', 'running', 'retryable', 'conflict', 'completed'].map(
                (state) => (
                  <option key={state}>{state}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Operation kind
            <select name="kind" defaultValue={params.get('kind') ?? ''}>
              <option value="">All actions</option>
              {['provision', 'setup_link', 'install_grant', 'pause'].map(
                (kind) => (
                  <option key={kind}>{kind}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Organization ID
            <input
              name="organizationId"
              defaultValue={params.get('organizationId') ?? ''}
              maxLength={36}
            />
          </label>
          <button>Search operations</button>
        </fieldset>
      </form>
      <div className="actions">
        <button
          disabled={busy || !Number.isFinite(offset) || offset <= 0}
          onClick={() => move(Math.max(0, offset - 50))}
        >
          Previous operations
        </button>
        <button
          disabled={
            busy || !hasMore || !Number.isFinite(offset) || offset >= 10000
          }
          onClick={() => move(offset + 50)}
        >
          Next operations
        </button>
      </div>
    </div>
  );
}
