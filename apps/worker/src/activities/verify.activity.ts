import { Injectable } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { VerifyInput, VerifyResult } from '../../../../libs/common/src';
import { requiredEnv } from '../../../../libs/common/src';
import { jobLog } from '../job-log';

@Injectable()
export class VerifyActivity {
  async verifyDatabase(input: VerifyInput): Promise<VerifyResult> {
    const mongoUri = requiredEnv('MONGODB_URI');
    const client = new MongoClient(mongoUri);
    await client.connect();

    jobLog.info(`Verifying ${input.collections.length} collections in "${input.database}"…`);
    try {
      const db = client.db(input.database);
      const counts: Record<string, number> = {};

      for (const name of input.collections) {
        const count = await db.collection(name).countDocuments();
        counts[name] = count;
        console.log(`Collection ${name}: ${count} documents`);
        jobLog.info(`Collection "${name}": ${count.toLocaleString('en-US')} documents`);
      }

      jobLog.success('Verification passed');
      return { verified: true, counts };
    } catch (err) {
      jobLog.failure(`Verification of "${input.database}" failed`, err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
