import { Injectable } from '@nestjs/common';
import { Context, ApplicationFailure } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { SetUserPackageItemsInput, SetUserPackageItemsOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 500;

interface LegacyUser {
  _id: ObjectId;
  items?: ItemDoc[];
}

interface ItemDoc {
  _id?: ObjectId;
  prices?: PriceDoc[];
  type: string;
  quantity: number;
  createdAt?: number;
}

interface PriceDoc {
  _id?: ObjectId;
  price: number;
  currency: string;
}

interface UsageDoc {
  userId: ObjectId;
  quantity: number;
}

const USAGE_BASED_TYPES = new Set(['LIMIT', 'SIZE']);

function newItemId(): ObjectId {
  return new ObjectId();
}

function now(): number {
  return new Date().getTime();
}

function upsertItems(
  existingItems: ItemDoc[],
  upgrades: Record<string, { quantity: number; overwriteTime?: boolean }>,
  usageByType?: Record<string, number>,
): { items: ItemDoc[]; changed: boolean } {
  const items = [...existingItems];
  let changed = false;

  for (const [type, config] of Object.entries(upgrades)) {
    const idx = items.findIndex((i) => i.type === type);
    const isUsageBased = USAGE_BASED_TYPES.has(type);
    const base = isUsageBased ? (usageByType?.[type] ?? 0) : (idx >= 0 ? items[idx].quantity : 0);
    const newQuantity = base + config.quantity;

    if (idx >= 0) {
      const current = items[idx];
      const updates: Partial<ItemDoc> = { quantity: newQuantity };
      if (config.overwriteTime) {
        updates.createdAt = now();
      }
      if (current.quantity !== newQuantity || (config.overwriteTime && current.createdAt !== updates.createdAt)) {
        items[idx] = { ...current, ...updates };
        changed = true;
      }
    } else {
      items.push({
        _id: newItemId(),
        prices: [],
        type,
        quantity: newQuantity,
        createdAt: config.overwriteTime ? now() : undefined,
      });
      changed = true;
    }
  }

  return { items, changed };
}

function buildUsageMap(usageDocs: UsageDoc[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const doc of usageDocs) {
    map.set(doc.userId.toHexString(), doc.quantity);
  }
  return map;
}

@Injectable()
export class SetUserPackageItemsActivity {
  async setUserPackageItems(input: SetUserPackageItemsInput): Promise<SetUserPackageItemsOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const heartbeatDetails = Context.current().info.heartbeatDetails as { lastId?: string } | undefined;
    const resumeId = input.lastId ?? heartbeatDetails?.lastId;

    let lastId: ObjectId | null = null;
    if (resumeId) {
      try {
        lastId = new ObjectId(resumeId);
      } catch {
        throw ApplicationFailure.nonRetryable(
          `Invalid lastId: "${resumeId}" is not a valid ObjectId`,
        );
      }
    }

    const upgrades = {
      LIMIT: { quantity: input.limitQuantity },
      SIZE: { quantity: input.sizeQuantity },
      TRAFFIC: { quantity: input.trafficQuantity },
      YEAR: { quantity: input.yearQuantity, overwriteTime: true },
    };

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalProcessed = 0;
    let totalModified = 0;
    let batch = 0;

    try {
      await client.connect();
      const db = client.db(database);
      const collection = db.collection('user');

      while (true) {
        const filter: Record<string, unknown> = { isLegacy: true };
        if (lastId) {
          filter._id = { $gt: lastId };
        }

        const users = await collection
          .find(filter)
          .project<LegacyUser>({ _id: 1, items: 1 })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (users.length === 0) {
          break;
        }

        lastId = users[users.length - 1]._id;

        const userIds = users.map((u) => u._id);
        const [limitUsageDocs, sizeUsageDocs] = await Promise.all([
          db.collection('limit_usage').find({ userId: { $in: userIds } }).project<UsageDoc>({ userId: 1, quantity: 1 }).toArray(),
          db.collection('size_usage').find({ userId: { $in: userIds } }).project<UsageDoc>({ userId: 1, quantity: 1 }).toArray(),
        ]);
        const limitUsageMap = buildUsageMap(limitUsageDocs);
        const sizeUsageMap = buildUsageMap(sizeUsageDocs);

        let batchModified = 0;

        const bulkOps = users
          .map((u) => {
            const usageByType: Record<string, number> = {
              LIMIT: limitUsageMap.get(u._id.toHexString()) ?? 0,
              SIZE: sizeUsageMap.get(u._id.toHexString()) ?? 0,
            };
            const { items, changed } = upsertItems(u.items ?? [], upgrades, usageByType);
            if (!changed) return null;
            return {
              updateOne: {
                filter: { _id: u._id },
                update: { $set: { items } },
              },
            };
          })
          .filter((op): op is NonNullable<typeof op> => op !== null);

        if (bulkOps.length > 0) {
          const result = await collection.bulkWrite(bulkOps);
          batchModified = result.modifiedCount;
        }

        totalProcessed += users.length;
        totalModified += batchModified;
        batch++;

        jobLog.info(
          `Batch ${batch}: processed ${users.length} users, modified ${batchModified} packages (total modified: ${totalModified})`,
        );

        Context.current().heartbeat({ batch, totalModified, lastId: lastId.toHexString() });
      }

      jobLog.success(
        `Completed: ${totalModified} legacy user packages upgraded across ${batch} batches`,
      );

      return { totalProcessed, totalModified, batches: batch, completed: true };
    } catch (err) {
      jobLog.failure('SetUserPackageItems failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
