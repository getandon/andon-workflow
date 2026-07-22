import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateOrderActivityInput, GenerateOrderActivityOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 50;

function toHex(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.toHexString) return v.toHexString();
  return String(v);
}

function toObjectId(v: any): ObjectId {
  if (v instanceof ObjectId) return v;
  return new ObjectId(toHex(v));
}

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
    let lastId: ObjectId | null = input.lastId ? new ObjectId(input.lastId) : null;

    try {
      await client.connect();
      const db = client.db(database);

      while (true) {
        const filter: any = lastId ? { _id: { $gt: lastId } } : {};
        const orders = await db
          .collection('order')
          .find(filter)
          .project<{ _id: ObjectId; user?: any; createdAt: number }>({
            _id: 1,
            user: 1,
            createdAt: 1,
          })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (orders.length === 0) break;

        const userIds = [...new Set(orders.filter(o => o.user).map(o => toHex(o.user)))];
        const users = userIds.length > 0
          ? await db
            .collection('user')
            .find({ _id: { $in: userIds.map(id => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name?: string; email: string }>({ _id: 1, name: 1, email: 1 })
            .toArray()
          : [];

        const userMap = new Map<string, { name?: string; email: string }>();
        for (const u of users) {
          userMap.set(u._id.toHexString(), { name: u.name, email: u.email });
        }

        for (const order of orders) {
          const orderId = order._id.toHexString();
          const actorHex = toHex(order.user);
          if (!actorHex) {
            jobLog.warn(`Order ${orderId} has no user, skipping`);
            continue;
          }

          const userObjId = toObjectId(order.user);
          const user = userMap.get(actorHex);
          const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

          const eventId = `Backfill_PaymentCaptured_${orderId}`;
          const createdAt = Number(order.createdAt) || order._id.getTimestamp().getTime();

          try {
            const eventObjId = new ObjectId();
            await db.collection('activity_event').insertOne({
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

            const isoTs = new Date(createdAt).toISOString().substring(0, 23);
            await db.collection('activity_summary').updateOne(
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
              { upsert: true },
            );

            eventsCreated++;
          } catch (err: any) {
            if (err.code === 11000) {
              continue;
            }
            throw err;
          }

          totalOrders++;
        }

        lastId = orders[orders.length - 1]._id;
        batch++;

        jobLog.info(
          `Batch ${batch}: ${orders.length} orders → total orders: ${totalOrders}, events: ${eventsCreated}`,
        );

        Context.current().heartbeat({
          batch,
          lastId: lastId.toHexString(),
          totalOrders,
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