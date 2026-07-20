import { Injectable } from '@nestjs/common';
import { Context, ApplicationFailure } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import {
  SetUserPackageItemsByIdentityInput,
  SetUserPackageItemsByIdentityOutput,
  PACKAGE_TYPE_CONFIG,
  toBaseQuantity,
  requiredEnv,
} from '@andon-workflow/lib';
import type { PackageType } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 50;

interface UserDoc {
  _id: ObjectId;
  email: string;
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

function newItemId(): ObjectId {
  return new ObjectId();
}

function now(): number {
  return new Date().getTime();
}

function upsertItem(
  existingItems: ItemDoc[],
  type: string,
  quantity: number,
  mode: string,
  usageQuantity: number,
): { items: ItemDoc[]; changed: boolean } {
  const items = [...existingItems];
  let changed = false;
  const idx = items.findIndex((i) => i.type === type);
  const existing = idx >= 0 ? items[idx] : null;
  const shouldOverwriteTime = mode === 'set';

  let newQuantity: number;
  if (mode === 'usage_based') {
    newQuantity = usageQuantity + quantity;
  } else if (mode === 'set') {
    newQuantity = quantity;
  } else {
    newQuantity = (existing?.quantity ?? 0) + quantity;
  }

  if (existing) {
    const updates: Partial<ItemDoc> = { quantity: newQuantity };
    if (shouldOverwriteTime) {
      updates.createdAt = now();
    }
    if (existing.quantity !== newQuantity || (shouldOverwriteTime && existing.createdAt !== updates.createdAt)) {
      items[idx] = { ...existing, ...updates };
      changed = true;
    }
  } else {
    items.push({
      _id: newItemId(),
      prices: [],
      type,
      quantity: newQuantity,
      createdAt: shouldOverwriteTime ? now() : undefined,
    });
    changed = true;
  }

  return { items, changed };
}

@Injectable()
export class SetUserPackageItemsByIdentityActivity {
  async setUserPackageItemsByIdentity(
    input: SetUserPackageItemsByIdentityInput,
  ): Promise<SetUserPackageItemsByIdentityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const invalidEntries: string[] = [];
    for (const entry of input.entries) {
      for (const pkg of entry.packages) {
        const typeConfig = PACKAGE_TYPE_CONFIG[pkg.type as keyof typeof PACKAGE_TYPE_CONFIG];
        if (!typeConfig) {
          invalidEntries.push(`${entry.email}: unknown type "${pkg.type}"`);
          continue;
        }
        if (!(typeConfig.allowedUnits as readonly string[]).includes(pkg.unit)) {
          invalidEntries.push(
            `${entry.email}: unit "${pkg.unit}" not allowed for type "${pkg.type}" (allowed: ${typeConfig.allowedUnits.join(', ')})`,
          );
        }
        if (!(typeConfig.supportedModes as readonly string[]).includes(pkg.mode)) {
          invalidEntries.push(
            `${entry.email}: mode "${pkg.mode}" not supported for type "${pkg.type}" (supported: ${typeConfig.supportedModes.join(', ')})`,
          );
        }
      }
    }
    if (invalidEntries.length > 0) {
      throw ApplicationFailure.nonRetryable(
        `Invalid entries detected:\n${invalidEntries.join('\n')}`,
      );
    }

    const heartbeatDetails = Context.current().info.heartbeatDetails as
      | { processed?: number; lastEmail?: string }
      | undefined;
    const resumeIndex = heartbeatDetails?.processed ?? 0;

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalProcessed = 0;
    let totalModified = 0;
    let batch = 0;
    const notFound: string[] = [];

    try {
      await client.connect();
      const db = client.db(database);
      const userCollection = db.collection('user');

      for (let offset = resumeIndex; offset < input.entries.length; offset += batchSize) {
        const chunk = input.entries.slice(offset, offset + batchSize);
        const emails = chunk.map((e) => e.email.trim().toLowerCase());

        const configByEmail = new Map<string, typeof chunk[0]['packages']>();
        for (const entry of chunk) {
          configByEmail.set(entry.email.trim().toLowerCase(), entry.packages);
        }

        const users = await userCollection
          .find({ email: { $in: emails } })
          .project<UserDoc>({ _id: 1, email: 1, items: 1 })
          .toArray();

        const userByEmail = new Map<string, UserDoc>();
        for (const u of users) {
          userByEmail.set(u.email, u);
        }

        for (const email of emails) {
          if (!userByEmail.has(email)) {
            notFound.push(email);
          }
        }

        const userIds = users.map((u) => u._id);
        const [limitUsageDocs, sizeUsageDocs] = await Promise.all([
          db
            .collection('limit_usage')
            .find({ userId: { $in: userIds } })
            .project<UsageDoc>({ userId: 1, quantity: 1 })
            .toArray(),
          db
            .collection('size_usage')
            .find({ userId: { $in: userIds } })
            .project<UsageDoc>({ userId: 1, quantity: 1 })
            .toArray(),
        ]);

        const usageMap = new Map<string, { limit: number; size: number }>();
        for (const doc of limitUsageDocs) {
          const key = doc.userId.toHexString();
          const entry = usageMap.get(key) ?? { limit: 0, size: 0 };
          entry.limit = doc.quantity;
          usageMap.set(key, entry);
        }
        for (const doc of sizeUsageDocs) {
          const key = doc.userId.toHexString();
          const entry = usageMap.get(key) ?? { limit: 0, size: 0 };
          entry.size = doc.quantity;
          usageMap.set(key, entry);
        }

        let batchModified = 0;

        const bulkOps = users
          .map((u) => {
            const packages = configByEmail.get(u.email);
            if (!packages || packages.length === 0) return null;

            let items = u.items ?? [];
            let userChanged = false;

            for (const pkg of packages) {
              const usages = usageMap.get(u._id.toHexString());
              let usageQty = 0;
              if (pkg.mode === 'usage_based') {
                if (pkg.type === 'LIMIT') usageQty = usages?.limit ?? 0;
                else if (pkg.type === 'SIZE') usageQty = usages?.size ?? 0;
              }

              const baseQty = toBaseQuantity(pkg.type as PackageType, pkg.quantity, pkg.unit);
              const result = upsertItem(items, pkg.type, baseQty, pkg.mode, usageQty);
              items = result.items;
              if (result.changed) userChanged = true;
            }

            if (!userChanged) return null;

            return {
              updateOne: {
                filter: { _id: u._id },
                update: { $set: { items } },
              },
            };
          })
          .filter((op): op is NonNullable<typeof op> => op !== null);

        if (bulkOps.length > 0) {
          const result = await userCollection.bulkWrite(bulkOps);
          batchModified = result.modifiedCount;
        }

        totalProcessed += chunk.length;
        totalModified += batchModified;
        batch++;

        jobLog.info(
          `Batch ${batch}: processed ${chunk.length} entries, modified ${batchModified} users, notFound: ${notFound.length} so far (total modified: ${totalModified})`,
        );

        Context.current().heartbeat({
          processed: offset + batchSize,
          lastEmail: chunk[chunk.length - 1].email,
          totalModified,
        });
      }

      jobLog.success(
        `Completed: ${totalModified} users modified across ${batch} batches, ${notFound.length} emails not found`,
      );

      return { totalProcessed, totalModified, notFound, batches: batch, completed: true };
    } catch (err) {
      jobLog.failure('SetUserPackageItemsByIdentity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
