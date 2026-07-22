import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient } from 'mongodb';
import { ClearActivityDataInput, ClearActivityDataOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';

@Injectable()
export class ClearActivityDataActivity {
  async clearActivityData(
    input: ClearActivityDataInput = {},
  ): Promise<ClearActivityDataOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });

    try {
      await client.connect();
      const db = client.db(database);

      jobLog.warn('Clearing activity data — this is destructive');

      const eventsResult = await db.collection('activity_event').deleteMany({});
      const activityEventsDeleted = eventsResult.deletedCount;

      const summariesResult = await db.collection('activity_summary').deleteMany({});
      const activitySummariesDeleted = summariesResult.deletedCount;

      const busEventsResult = await db.collection('processed_bus_event').deleteMany({});
      const processedBusEventsDeleted = busEventsResult.deletedCount;

      Context.current().heartbeat({
        activityEventsDeleted,
        activitySummariesDeleted,
        processedBusEventsDeleted,
      });

      jobLog.success(
        `Cleared: ${activityEventsDeleted} activity events, ${activitySummariesDeleted} activity summaries, ${processedBusEventsDeleted} processed bus events`,
      );

      return {
        activityEventsDeleted,
        activitySummariesDeleted,
        processedBusEventsDeleted,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('ClearActivityData failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
