import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import { MigrateInput, execAsync } from '@andon-workflow/lib';
import { jobLog } from '../job-log';

@Injectable()
export class MigrateActivity {
  async runMigration(input: MigrateInput): Promise<void> {
    const configPath = process.env.MIGRATE_MONGO_PATH ?? './migrate-mongo-config.js';

    if (!existsSync(configPath)) {
      console.log(`Migration config not found at ${configPath}, skipping migration step`);
      jobLog.info('No migration config found — migration step skipped');
      return;
    }

    jobLog.info('Running database migrations…');
    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await execAsync(`npx migrate-mongo up -f "${configPath}"`));
    } catch (err) {
      jobLog.failure('Database migration failed', err);
      throw err;
    }

    console.log(`Migration output: ${stdout}`);
    if (stderr) {
      console.error(`Migration stderr: ${stderr}`);
      jobLog.warn(`Migration warnings:\n${stderr.trim().split('\n').slice(-20).join('\n')}`);
    }
    const tail = stdout.trim().split('\n').slice(-20).join('\n');
    jobLog.success(tail ? `Migrations applied:\n${tail}` : 'Migrations applied');
  }
}
