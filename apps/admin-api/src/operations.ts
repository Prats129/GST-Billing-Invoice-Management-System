import type { Pool } from 'pg';
import { store, rows, transaction, audit } from './store.js';
import { verifyEntitlement } from '@gst/security';
import type { PlatformService } from './service.js';
import type { PlatformConfig } from './config.js';
import { fail } from './errors.js';
interface Operation {
  id: string;
  organization_id: string;
  kind: string;
  payload: Record<string, unknown>;
  state: string;
  attempts: number;
}
export class Operations {
  readonly operator: Pool | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(
    readonly service: PlatformService,
    readonly config: PlatformConfig,
  ) {
    if (config.SAAS_OPERATOR_DATABASE_URL)
      this.operator = store(config.SAAS_OPERATOR_DATABASE_URL);
  }
  origin() {
    if (!this.config.SAAS_APP_ORIGIN) fail('SAAS_NOT_CONFIGURED', 503);
    return this.config.SAAS_APP_ORIGIN;
  }
  async lookup(id: string) {
    if (!this.operator) fail('SAAS_NOT_CONFIGURED', 503);
    const [r] = await rows<{
      value: {
        name: string;
        runtimeId: string;
        entitlement: unknown;
        paused: boolean;
        setupComplete: boolean;
      };
    }>(this.operator, 'SELECT platform_operator.lookup($1::uuid) AS value', [
      id,
    ]);
    if (!r?.value) fail('NOT_FOUND', 404);
    return r.value;
  }
  async execute(id: string) {
    if (!this.operator) return undefined;
    const [control] = await rows<{ operations_enabled: boolean }>(
      this.service.db,
      'SELECT operations_enabled FROM platform_control',
    );
    if (!control?.operations_enabled) return undefined;
    const op = await transaction(this.service.db, async (tx) => {
      const [row] = await rows<Operation>(
        tx,
        "SELECT * FROM platform_operations WHERE id=$1 AND ((state IN ('pending','retryable') AND next_attempt_at<=now()) OR (state='running' AND lease_until<now())) FOR UPDATE SKIP LOCKED",
        [id],
      );
      if (!row) return undefined;
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [
        row.organization_id,
      ]);
      const [before] = await rows(
        tx,
        "SELECT id FROM platform_operations WHERE organization_id=$1 AND (created_at,id)<(SELECT created_at,id FROM platform_operations WHERE id=$2) AND state NOT IN ('completed','conflict') LIMIT 1",
        [row.organization_id, id],
      );
      if (before) return undefined;
      await tx.query(
        "UPDATE platform_operations SET state='running',lease_until=now()+interval '1 minute',attempts=attempts+1 WHERE id=$1",
        [id],
      );
      return row;
    });
    if (!op) {
      const [r] = await rows<{ state: string }>(
        this.service.db,
        'SELECT state FROM platform_operations WHERE id=$1',
        [id],
      );
      return r;
    }
    try {
      if (op.kind === 'install_grant')
        verifyEntitlement(op.payload.envelope, this.service.trust);
      const [response] = await rows<{ result: Record<string, unknown> }>(
        this.operator,
        'SELECT platform_operator.execute($1::uuid,$2,$3::jsonb) AS result',
        [op.id, op.kind, JSON.stringify(op.payload)],
      );
      if (!response) throw new Error('Missing receipt');
      await transaction(this.service.db, async (tx) => {
        await tx.query(
          "UPDATE platform_operations SET state='completed',result=$2,error_code=NULL,lease_until=NULL,completed_at=now() WHERE id=$1",
          [id, response.result],
        );

        await audit(tx, null, 'operation.completed', op.organization_id, id, {
          kind: op.kind,
        });
      });
      return { state: 'completed' };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      const state = ['22023', '22001', '23505', '23514', 'P0001'].includes(code)
        ? 'conflict'
        : 'retryable';
      await transaction(this.service.db, async (tx) => {
        await tx.query(
          "UPDATE platform_operations SET state=$2,error_code=$3,lease_until=NULL,next_attempt_at=now()+interval '1 minute' WHERE id=$1",
          [
            id,
            state,
            state === 'conflict' ? 'STATE_CONFLICT' : 'OPERATOR_UNAVAILABLE',
          ],
        );
        await audit(tx, null, 'operation.' + state, op.organization_id, id);
      });
      return { state };
    }
  }
  async tick() {
    if (this.running || !this.operator) return;
    this.running = true;
    try {
      const [control] = await rows<{ operations_enabled: boolean }>(
        this.service.db,
        'SELECT operations_enabled FROM platform_control',
      );
      if (!control?.operations_enabled) return;
      const pending = await rows<{ id: string }>(
        this.service.db,
        "SELECT id FROM platform_operations WHERE (state IN ('pending','retryable') AND next_attempt_at<=now()) OR (state='running' AND lease_until<now()) ORDER BY created_at,id LIMIT 5",
      );
      for (const op of pending) await this.execute(op.id);
    } catch {
      process.stderr.write('{"event":"platform_worker_error"}\n');
    } finally {
      this.running = false;
    }
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
    void this.tick();
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.operator?.end();
  }
}
