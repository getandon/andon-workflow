import { Injectable } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import { RestoreInput, execAsync, assertSafeName, createS3Client, requiredEnv, S3_URI_REGEX } from '@andon-workflow/lib';
import { jobLog } from '../job-log';

@Injectable()
export class RestoreActivity {
  async restoreDatabase(input: RestoreInput): Promise<void> {
    const database = assertSafeName(input.database, 'database name');
    const match = input.backupLocation.match(S3_URI_REGEX);
    if (!match) throw new Error(`Invalid S3 URI: ${input.backupLocation}`);
    const [, bucket, key] = match;
    const filepath = `/tmp/restore-${Date.now()}.dump`;

    jobLog.info(`Downloading backup from ${input.backupLocation}…`);
    try {
      const s3 = createS3Client();
      const getCmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const response = await s3.send(getCmd);

      const writeStream = createWriteStream(filepath);
      await pipeline(response.Body as any, writeStream);
    } catch (err) {
      jobLog.failure('Download of backup from S3 failed', err);
      throw err;
    }

    const mongoUri = requiredEnv('MONGODB_URI');
    const baseUri = mongoUri.replace(/\/[^/]+$/, '');
    jobLog.info(`Restoring into "${database}" (drop + restore)…`);
    try {
      await execAsync(`mongorestore --uri="${baseUri}" --db="${database}" --archive="${filepath}" --gzip --drop`);
    } catch (err) {
      jobLog.failure(`Restore into "${database}" failed`, err);
      throw err;
    }

    unlinkSync(filepath);
    console.log(`Restore complete: ${database} from ${input.backupLocation}`);
    jobLog.success(`Restore complete — "${database}" now matches the backup`);
  }
}
