import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { CalculateAlbumSummaryInput, CalculateAlbumSummaryOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'pixo';
const DEFAULT_BATCH_SIZE = 50;

@Injectable()
export class CalculateAlbumSummaryActivity {
  async calculateAlbumSummary(
    input: CalculateAlbumSummaryInput = {},
  ): Promise<CalculateAlbumSummaryOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri);
    let totalAlbums = 0;
    let totalMedias = 0;
    let totalSize = 0;
    let totalImages = 0;
    let totalVideos = 0;
    let totalUsers = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let batch = 0;
    let lastId: ObjectId | null = input.lastId ? new ObjectId(input.lastId) : null;

    try {
      await client.connect();
      const db = client.db(database);

      while (true) {
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const albums = await db
          .collection('album')
          .find(filter)
          .project<{ _id: ObjectId }>({ _id: 1 })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (albums.length === 0) break;

        for (const album of albums) {
          const albumUsers = await db
            .collection('album_role')
            .countDocuments({ album: album._id, userRole: { $in: ['GUEST', 'MANAGER'] } });

          const [result] = await db
            .collection('media')
            .aggregate([
              { $match: { album: album._id } },
              {
                $group: {
                  _id: null,
                  medias: { $sum: 1 },
                  size: { $sum: { $ifNull: ['$size', 0] } },
                  images: { $sum: { $cond: [{ $eq: ['$type', 'IMAGE'] }, 1, 0] } },
                  videos: { $sum: { $cond: [{ $eq: ['$type', 'VIDEO'] }, 1, 0] } },
                  likes: { $sum: { $ifNull: ['$likes', 0] } },
                  comments: { $sum: { $ifNull: ['$comments', 0] } },
                },
              },
            ])
            .toArray();

          const medias = result?.medias ?? 0;
          const size = result?.size ?? 0;
          const images = result?.images ?? 0;
          const videos = result?.videos ?? 0;
          const likes = result?.likes ?? 0;
          const comments = result?.comments ?? 0;

          await db.collection('album').updateOne(
            { _id: album._id },
            {
              $set: { medias, size, images, videos, users: albumUsers, likes, comments },
            },
          );

          totalMedias += medias;
          totalSize += size;
          totalImages += images;
          totalVideos += videos;
          totalUsers += albumUsers;
          totalLikes += likes;
          totalComments += comments;
          totalAlbums++;
        }

        lastId = albums[albums.length - 1]._id;
        batch++;

        jobLog.info(
          `Batch ${batch}: ${albums.length} albums → total albums: ${totalAlbums}, medias: ${totalMedias}, size: ${totalSize}`,
        );

        Context.current().heartbeat({
          batch,
          lastId: lastId.toHexString(),
          totalAlbums,
          totalMedias,
          totalSize,
          totalImages,
          totalVideos,
          totalUsers,
          totalLikes,
          totalComments,
        });
      }

      jobLog.success(
        `Completed: ${totalAlbums} albums, ${totalMedias} medias, ${totalImages} images, ${totalVideos} videos, ${totalUsers} users, ${totalSize} bytes`,
      );

      return {
        totalAlbums,
        totalMedias,
        totalSize,
        totalImages,
        totalVideos,
        totalUsers,
        totalLikes,
        totalComments,
        batches: batch,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('CalculateAlbumSummary failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
