import { Icon } from './ui.js';
export interface ConnectionState {
  api: string;
  database: string;
}
export function connectionHealthy(connection: ConnectionState) {
  return connection.api === 'Connected' && connection.database === 'Ready';
}
export function ConnectionIndicator({
  connection,
}: {
  connection: ConnectionState;
}) {
  const healthy = connectionHealthy(connection);
  const checking =
    connection.api.startsWith('Checking') ||
    connection.database.startsWith('Checking');
  return (
    <span
      className={`connection-indicator ${healthy ? 'is-online' : checking ? 'is-checking' : 'is-offline'}`}
    >
      <span className="status-dot" />
      {healthy
        ? 'All systems operational'
        : checking
          ? 'Checking connection'
          : 'Connection needs attention'}
    </span>
  );
}
export function ConnectionPanel({
  connection,
  onCheck,
}: {
  connection: ConnectionState;
  onCheck: () => void;
}) {
  return (
    <section className="surface connection-panel">
      <div className="card-heading">
        <span className="feature-icon">
          <Icon name="server" />
        </span>
        <div>
          <h2>Connection status</h2>
          <p>Live availability of your workspace services.</p>
        </div>
      </div>
      <dl className="connection-details">
        <div>
          <dt>Application server</dt>
          <dd>{connection.api}</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>{connection.database}</dd>
        </div>
      </dl>
      <div className="card-footer">
        <ConnectionIndicator connection={connection} />
        <button className="button button-secondary" onClick={onCheck}>
          <Icon name="refresh" size={16} />
          Check again
        </button>
      </div>
    </section>
  );
}
