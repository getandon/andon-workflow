import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient } from 'mongodb';
import { DedupeAlbumRoleInput, DedupeAlbumRoleOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';

const ROLE_PRECEDENCE: Record<string, number> = {
  OWNER: 4,
  MANAGER: 3,
  GUEST: 2,
  NONE: 1,
};

@Injectable()
export class DedupeAlbumRoleActivity {
  async dedupeAlbumRole(
    input: DedupeAlbumRoleInput = {},
  ): Promise<DedupeAlbumRoleOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });

    try {
      await client.connect();
      const db = client.db(database);
      const albumRole = db.collection('album_role');

      const duplicates = await albumRole
        .aggregate([
          {
            $group: {
              _id: { user: '$user', album: '$album' },
              docs: {
                $push: {
                  id: '$_id',
                  userRole: '$userRole',
                  createdAt: '$createdAt',
                },
              },
              count: { $sum: 1 },
            },
          },
          { $match: { count: { $gt: 1 } } },
        ])
        .toArray();

      const idsToDelete: any[] = [];
      for (const group of duplicates) {
        const docs = (group.docs as any[]).slice().sort((a, b) => {
          const pa = ROLE_PRECEDENCE[a.userRole] ?? 0;
          const pb = ROLE_PRECEDENCE[b.userRole] ?? 0;
          if (pa !== pb) {
            return pb - pa;
          }
          return (a.createdAt ?? 0) - (b.createdAt ?? 0);
        });
        for (const doc of docs.slice(1)) {
          idsToDelete.push(doc.id);
        }
      }

      const duplicatesFound = duplicates.length;
      let duplicatesDeleted = 0;
      let indexCreated = false;

      if (!input.dryRun) {
        if (idsToDelete.length > 0) {
          const result = await albumRole.deleteMany({ _id: { $in: idsToDelete } });
          duplicatesDeleted = result.deletedCount ?? 0;
        }
        await albumRole.createIndex({ user: 1, album: 1 }, { unique: true });
        indexCreated = true;
      }

      Context.current().heartbeat({ duplicatesFound, duplicatesDeleted, indexCreated });

      jobLog.success(
        `DedupeAlbumRole: ${duplicatesFound} duplicate group(s) found, ${duplicatesDeleted} row(s) deleted, indexCreated=${indexCreated}${input.dryRun ? ' (dry run)' : ''}`,
      );

      return {
        duplicatesFound,
        duplicatesDeleted,
        indexCreated,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('DedupeAlbumRole failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
