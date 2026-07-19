import { Context } from '@temporalio/activity';
import * as os from 'os';
import { buildApiTlsOptions, apiRequest, ApiTlsRequestOptions } from '@andon-workflow/lib';

const API_URL = process.env.ANDON_API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';
const API_TLS: ApiTlsRequestOptions | undefined = buildApiTlsOptions();

export type JobLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

interface JobLogEntryPayload {
  ts: string;
  level: JobLogLevel;
  step?: string;
  source: string;
  message: string;
}

function workerName(): string {
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'source';
  return process.env.WORKER_NAME ?? `${os.hostname()}-${taskQueue}`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  return headers;
}

function post(level: JobLogLevel, message: string) {
  let workflowId: string | undefined;
  let step: string | undefined;
  try {
    const info = Context.current().info;
    workflowId = info.workflowExecution?.workflowId;
    step = info.activityType;
  } catch {
    return;
  }
  if (!workflowId) return;

  const entry: JobLogEntryPayload = {
    ts: new Date().toISOString(),
    level,
    step,
    source: workerName(),
    message,
  };

  void apiRequest(
    `${API_URL}/api/jobs/logs`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ workflowId, entries: [entry] }),
    },
    API_TLS,
  ).catch(() => {});
}

function stderrTail(err: unknown, lines = 20): string | null {
  const e = err as { stderr?: unknown; stdout?: unknown };
  const raw = [e?.stderr, e?.stdout]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n');
  if (!raw) return null;
  const tail = raw.trim().split('\n').slice(-lines).join('\n');
  return tail || null;
}

export const jobLog = {
  info: (message: string) => post('INFO', message),
  warn: (message: string) => post('WARN', message),
  error: (message: string) => post('ERROR', message),
  success: (message: string) => post('SUCCESS', message),
  failure(summary: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post('ERROR', `${summary}: ${message}`);
    const tail = stderrTail(err);
    if (tail) post('ERROR', `Command output (tail):\n${tail}`);
  },
};
