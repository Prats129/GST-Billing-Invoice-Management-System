// Invoked by the native launcher through stdin, never by the customer HTTP API.
import {
  lifecycleRequestSchema,
  prepareLifecycle,
  executeLifecycle,
  LifecycleError,
} from './windows-lifecycle.js';
import { z } from 'zod';
const emit = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + '\n');
try {
  if (process.platform !== 'win32' || process.argv.length !== 2)
    throw new LifecycleError('INPUT_INVALID');
  const parts: Buffer[] = [];
  let length = 0;
  for await (const part of process.stdin) {
    length += (part as Buffer).length;
    if (length > 65536) throw new LifecycleError('INPUT_INVALID');
    parts.push(part as Buffer);
  }
  const input = z
    .object({
      mode: z.enum(['preview', 'execute']),
      request: lifecycleRequestSchema,
      approval: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict()
    .parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
  if (input.mode === 'preview') {
    if (input.approval) throw new LifecycleError('INPUT_INVALID');
    const { summary, approval } = await prepareLifecycle(input.request);
    emit({ event: 'preview', summary, approval });
  } else {
    if (!input.approval) throw new LifecycleError('INPUT_INVALID');
    const result = await executeLifecycle(
      input.request,
      input.approval,
      (phase) => emit({ event: 'progress', phase }),
    );
    emit({ event: 'completed', result });
  }
} catch (error) {
  emit({
    event: 'failed',
    code:
      error instanceof LifecycleError
        ? error.code
        : error instanceof z.ZodError
          ? 'INPUT_INVALID'
          : 'OPERATION_FAILED',
    message:
      error instanceof LifecycleError
        ? error.message
        : error instanceof z.ZodError
          ? 'Check these fields: ' +
            [
              ...new Set(
                error.issues.slice(0, 10).map((issue) => issue.path.join('.')),
              ),
            ].join(', ') +
            '. Return to the task form and correct them before reviewing again.'
          : 'The operation could not be verified as complete. Check the installation and retained operation records before retrying.',
  });
  process.exitCode = 1;
}
