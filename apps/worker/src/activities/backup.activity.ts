import { Injectable } from '@nestjs/common';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream, statSync, unlinkSync } from 'fs';
import { BackupInput, BackupResult } from '../../../../libs/common/src';
import { execAsync, assertSafeName, createS3Client, requiredEnv } from '../../../../libs/common/src';
import { DEFAULT_S3_BUCKET } from '../../../../libs/common/src';
import { jobLog } from '../job-log';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

@Injectable()
export class BackupActivity {
  async backupDatabase(input: BackupInput): Promise<BackupResult> {
    const database = assertSafeName(input.database, 'database name');
    const timestamp = Date.now();
    const filename = `${database}-${timestamp}.dump`;
    const filepath = `/tmp/${filename}`;
    const mongoUri = requiredEnv('MONGODB_URI');
    const baseUri = mongoUri.replace(/\/[^/]+$/, '');

    jobLog.info(`Dumping database "${database}"…`);
    try {
      await execAsync(`mongodump --uri="${baseUri}" --db="${database}" --archive="${filepath}" --gzip`);
    } catch (err) {
      jobLog.failure(`Backup of "${database}" failed`, err);
      throw err;
    }

    const size = statSync(filepath).size;
    const s3 = createS3Client();
    const bucket = process.env.S3_BUCKET ?? DEFAULT_S3_BUCKET;

    jobLog.info(`Uploading backup to S3 (${formatBytes(size)})…`);
    try {
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: filename,
          Body: createReadStream(filepath),
        },
      });
      await upload.done();
    } catch (err) {
      jobLog.failure('Upload of backup to S3 failed', err);
      throw err;
    }

    unlinkSync(filepath);

    const location = `s3://${bucket}/${filename}`;
    console.log(`Backup complete: ${location}`);
    jobLog.success(`Backup uploaded: ${location} (${formatBytes(size)})`);
    return { location };
  }
}
