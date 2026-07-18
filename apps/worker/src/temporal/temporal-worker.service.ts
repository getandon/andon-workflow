import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as path from 'path';
import * as os from 'os';
import {
  TEMPORAL_DEFAULT_ADDRESS,
  buildTemporalTls,
  temporalNamespace,
  buildApiTlsOptions,
  apiRequest,
  ApiTlsRequestOptions,
} from '../../../../libs/common/src';
import { BackupActivity } from '../activities/backup.activity';
import { RestoreActivity } from '../activities/restore.activity';
import { MigrateActivity } from '../activities/migrate.activity';
import { VerifyActivity } from '../activities/verify.activity';

const API_URL = process.env.ANDON_API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '30000', 10);

const API_TLS: ApiTlsRequestOptions | undefined = buildApiTlsOptions();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  return headers;
}

@Injectable()
export class TemporalWorkerService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly workerName: string;
  private taskQueue = '';
  private environment = '';
  private activityNames: string[] = [];

  constructor(
    private readonly backup: BackupActivity,
    private readonly restore: RestoreActivity,
    private readonly migrate: MigrateActivity,
    private readonly verify: VerifyActivity,
  ) {
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'source';
    this.workerName = process.env.WORKER_NAME ?? `${os.hostname()}-${taskQueue}`;
  }

  async onModuleInit() {
    const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'source';
    const address = process.env.TEMPORAL_ADDRESS ?? TEMPORAL_DEFAULT_ADDRESS;
    const environment = taskQueue;

    const connection = await NativeConnection.connect({
      address,
      tls: buildTemporalTls(),
      apiKey: process.env.TEMPORAL_API_KEY,
    });

    const activities = {
      backupDatabase: this.backup.backupDatabase.bind(this.backup),
      restoreDatabase: this.restore.restoreDatabase.bind(this.restore),
      runMigration: this.migrate.runMigration.bind(this.migrate),
      verifyDatabase: this.verify.verifyDatabase.bind(this.verify),
    };

    this.worker = await Worker.create({
      workflowsPath: path.resolve(__dirname, '../../../../libs/workflows/src'),
      activities,
      taskQueue,
      connection,
      namespace: temporalNamespace(),
      identity: this.workerName,
    });

    this.taskQueue = taskQueue;
    this.environment = environment;
    this.activityNames = Object.keys(activities);
    await this.registerWorker(taskQueue, environment, this.activityNames);

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    try {
      await this.worker.run();
    } catch (err) {
      console.error('Worker.run failed:', err);
      throw err;
    } finally {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    }
  }

  async onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async registerWorker(taskQueue: string, environment: string, activities: string[]) {
    try {
      const res = await apiRequest(
        `${API_URL}/api/workers/register`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: this.workerName, taskQueue, environment, activities, identity: this.workerName }),
        },
        API_TLS,
      );
      if (!res.ok) {
        console.warn(`Worker registration failed (HTTP ${res.status}): ${res.text}`);
      }
    } catch (err) {
      console.warn('Failed to register worker with API:', (err as Error).message);
    }
  }

  private async sendHeartbeat() {
    try {
      const res = await apiRequest(
        `${API_URL}/api/workers/${encodeURIComponent(this.workerName)}/heartbeat`,
        {
          method: 'POST',
          headers: authHeaders(),
        },
        API_TLS,
      );
      if (!res.ok) {
        await this.registerWorker(this.taskQueue, this.environment, this.activityNames);
      }
    } catch {}
  }
}
