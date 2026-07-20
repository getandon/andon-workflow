import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { CalculateUserPackageUsageInput, CalculateUserPackageUsageOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 10;

@Injectable()
export class CalculateUserPackageUsageActivity {
  async calculateUserPackageUsage(
    input: CalculateUserPackageUsageInput = {},
  ): Promise<CalculateUserPackageUsageOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalUsers = 0;
    let totalAlbums = 0;
    let totalMediaCount = 0;
    let totalSize = 0;
    let batch = 0;
    let lastId: ObjectId | null = input.lastId ? new ObjectId(input.lastId) : null;

    try {
      await client.connect();
      const db = client.db(database);

      while (true) {
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const users = await db
          .collection('user')
          .find(filter)
          .project<{ _id: ObjectId }>({ _id: 1 })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (users.length === 0) break;

        for (const user of users) {
          const albums = await db
            .collection('album')
            .find({ author: user._id })
            .project<{ _id: ObjectId }>({ _id: 1 })
            .toArray();

          if (albums.length === 0) continue;

          totalAlbums += albums.length;

          const [result] = await db
            .collection('media')
            .aggregate([
              { $match: { album: { $in: albums.map((a) => a._id) } } },
              {
                $group: {
                  _id: null,
                  mediaCount: { $sum: 1 },
                  totalSize: { $sum: { $ifNull: ['$size', 0] } },
                },
              },
            ])
            .toArray();

          const mediaCount = result?.mediaCount ?? 0;
          const userTotalSize = result?.totalSize ?? 0;

          totalMediaCount += mediaCount;
          totalSize += userTotalSize;

          await db
            .collection('limit_usage')
            .updateOne({ userId: user._id }, { $set: { quantity: mediaCount } }, { upsert: true });

          await db
            .collection('size_usage')
            .updateOne({ userId: user._id }, { $set: { quantity: userTotalSize } }, { upsert: true });

          totalUsers++;
        }

        lastId = users[users.length - 1]._id;
        batch++;

        jobLog.info(
          `Batch ${batch}: ${users.length} users → total users: ${totalUsers}, albums: ${totalAlbums}, media: ${totalMediaCount}, size: ${totalSize}`,
        );

        Context.current().heartbeat({
          batch,
          lastId: lastId.toHexString(),
          totalUsers,
          totalAlbums,
          totalMediaCount,
          totalSize,
        });
      }

      jobLog.success(
        `Completed: ${totalUsers} users, ${totalAlbums} albums, ${totalMediaCount} medias, ${totalSize} bytes`,
      );

      return { totalUsers, totalAlbums, totalMediaCount, totalSize, batches: batch, completed: true };
    } catch (err) {
      jobLog.failure('CalculateUserPackageUsage failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
