import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateOrderActivityInput, GenerateOrderActivityOutput, requiredEnv, toHex, toObjectId, fetchUserMap, insertActivityEvent, upsertActivitySummary, findUnprocessedBatch, markProcessed } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 50;

@Injectable()
export class GenerateOrderActivity {
  async generateOrderActivity(
    input: GenerateOrderActivityInput = {},
  ): Promise<GenerateOrderActivityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalOrders = 0;
    let eventsCreated = 0;
    let batch = 0;

    try {
      await client.connect();
      const db = client.db(database);

      while (true) {
        const orders: any[] = await findUnprocessedBatch(db, 'order', batchSize);

        if (orders.length === 0) break;

        const userIds = orders
          .filter(o => o.user)
          .map(o => toHex(o.user))
          .filter(h => h && h.length === 24);

        const userMap = await fetchUserMap(db, userIds);

        for (const order of orders) {
          const orderId = order._id.toHexString();
          const userRef = order.user && order.user._id ? order.user._id : order.user;
          const actorHex = toHex(userRef);
          let userObjId = toObjectId(userRef);
          if (!userObjId) {
            jobLog.warn(`Order ${orderId} has no user or invalid user reference, using placeholder actor`);
            userObjId = new ObjectId('000000000000000000000000');
          }

          const user = actorHex ? userMap.get(actorHex) : undefined;
          const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

          const eventId = `Backfill_PaymentCaptured_${orderId}`;
          const createdAt = Number(order.createdAt) || order._id.getTimestamp().getTime();

          try {
            const eventObjId = new ObjectId();
            await insertActivityEvent(db, {
              _id: eventObjId,
              eventId,
              userId: userObjId,
              actorId: userObjId,
              actorName,
              verb: 'PURCHASED',
              targetType: 'PACKAGE',
              targetId: order._id,
              metadata: { orderId },
              visibleToRoles: [],
              visibleToUserIds: [userObjId],
              visibilityVersion: 0,
              createdAt,
            });

            eventsCreated++;

            const isoTs = new Date(createdAt).toISOString().substring(0, 23);
            await upsertActivitySummary(
              db,
              {
                userId: userObjId,
                verb: 'PURCHASED',
                actorId: userObjId,
                timeWindow: isoTs,
              },
              {
                $setOnInsert: {
                  _id: new ObjectId(),
                  userId: userObjId,
                  verb: 'PURCHASED',
                  actorId: userObjId,
                  timeWindow: isoTs,
                  firstEventAt: createdAt,
                  metadata: { orderId },
                },
                $set: {
                  lastEventAt: createdAt,
                  actorName,
                  visibleToRoles: [],
                  visibleToUserIds: [userObjId],
                },
                $addToSet: { eventIds: eventObjId },
                $inc: { count: 1 },
              },
              eventId,
              jobLog,
            );
          } catch (err: any) {
            if (err.code === 11000) {
              continue;
            }
            throw err;
          }

          totalOrders++;
        }

        await markProcessed(db, 'order', orders.map(o => o._id));
        batch++;

        jobLog.info(
          `Batch ${batch}: ${orders.length} orders → total orders: ${totalOrders}, events: ${eventsCreated}`,
        );

        Context.current().heartbeat({
          batch,
          processedCount: totalOrders,
          eventsCreated,
        });
      }

      jobLog.success(
        `Completed: ${totalOrders} orders processed, ${eventsCreated} activity events created`,
      );

      return {
        totalOrders,
        eventsCreated,
        batches: batch,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('GenerateOrderActivity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
