import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateInviteActivityInput, GenerateInviteActivityOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_INVITE_BATCH_SIZE = 100;
const DEFAULT_ROLE_BATCH_SIZE = 100;

const INVITED_VISIBLE_ROLES = ['OWNER', 'MANAGER'];
const ACCEPTED_VISIBLE_ROLES = ['OWNER', 'MANAGER'];

@Injectable()
export class GenerateInviteActivity {
  async generateInviteActivity(
    input: GenerateInviteActivityInput = {},
  ): Promise<GenerateInviteActivityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const inviteBatchSize = input.inviteBatchSize ?? DEFAULT_INVITE_BATCH_SIZE;
    const roleBatchSize = input.roleBatchSize ?? DEFAULT_ROLE_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });

    let invitedCreated = 0;
    let acceptedCreated = 0;
    let invitesProcessed = 0;
    let rolesProcessed = 0;
    let batch = 0;

    try {
      await client.connect();
      const db = client.db(database);

      const runInvited = !input.phase || input.phase === 'invited';
      const runAccepted = !input.phase || input.phase === 'accepted';

      if (runInvited) {
        let lastInviteId: ObjectId | null = input.lastInviteId
          ? new ObjectId(input.lastInviteId)
          : null;

        while (true) {
          const filter: any = lastInviteId
            ? { _id: { $gt: lastInviteId }, removed: false }
            : { removed: false };

          const invites = await db
            .collection('album_invite')
            .find(filter)
            .project<{ _id: ObjectId; album: ObjectId; author: ObjectId; inviteKey: string; createdAt: number }>({
              _id: 1,
              album: 1,
              author: 1,
              inviteKey: 1,
              createdAt: 1,
            })
            .sort({ _id: 1 })
            .limit(inviteBatchSize)
            .toArray();

          if (invites.length === 0) break;

          const authorIds = [...new Set(invites.map(i => i.author.toHexString()))];
          const users = authorIds.length > 0
            ? await db
              .collection('user')
              .find({ _id: { $in: authorIds.map(id => new ObjectId(id)) } })
              .project<{ _id: ObjectId; name?: string; email: string }>({ _id: 1, name: 1, email: 1 })
              .toArray()
            : [];

          const userMap = new Map<string, { name?: string; email: string }>();
          for (const u of users) {
            userMap.set(u._id.toHexString(), { name: u.name, email: u.email });
          }

          for (const invite of invites) {
            const actorId = invite.author.toHexString();
            const user = userMap.get(actorId);
            const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

            const eventId = `Backfill_AlbumInvitesCreated_${invite._id.toHexString()}`;
            const createdAt = invite.createdAt || new Date().getTime();

            try {
              await db.collection('activity_event').insertOne({
                _id: new ObjectId(),
                eventId,
                albumId: invite.album,
                actorId: invite.author,
                actorName,
                verb: 'INVITED',
                targetType: 'INVITE',
                targetId: invite.album,
                metadata: { inviteCount: 1, invitees: [invite.inviteKey] },
                visibleToRoles: INVITED_VISIBLE_ROLES,
                visibleToUserIds: [],
                visibilityVersion: 0,
                createdAt,
              });

              const isoTs = new Date(createdAt).toISOString().substring(0, 23);
              await db.collection('activity_summary').updateOne(
                {
                  albumId: invite.album,
                  verb: 'INVITED',
                  actorId: invite.author,
                  timeWindow: isoTs,
                },
                {
                  $setOnInsert: {
                    _id: new ObjectId(),
                    albumId: invite.album,
                    verb: 'INVITED',
                    actorId: invite.author,
                    timeWindow: isoTs,
                    firstEventAt: createdAt,
                    metadata: { inviteCount: 1, invitees: [invite.inviteKey] },
                  },
                  $set: {
                    lastEventAt: createdAt,
                    actorName,
                    visibleToRoles: INVITED_VISIBLE_ROLES,
                    visibleToUserIds: [],
                  },
                  $addToSet: { eventIds: new ObjectId() },
                  $inc: { count: 1 },
                },
                { upsert: true },
              );

              invitedCreated++;
            } catch (err: any) {
              if (err.code === 11000) {
                continue;
              }
              throw err;
            }

            invitesProcessed++;
          }

          lastInviteId = invites[invites.length - 1]._id;
          batch++;

          jobLog.info(
            `INVITED batch ${batch}: ${invites.length} invites → events: ${invitedCreated}`,
          );

          Context.current().heartbeat({
            batch,
            lastInviteId: lastInviteId.toHexString(),
            invitedCreated,
            acceptedCreated,
            invitesProcessed,
            rolesProcessed,
            phase: 'invited',
          });
        }
      }

      if (runAccepted) {
        let lastRoleId: ObjectId | null = input.lastRoleId
          ? new ObjectId(input.lastRoleId)
          : null;

        while (true) {
          const filter: any = lastRoleId ? { _id: { $gt: lastRoleId } } : {};

          const roles = await db
            .collection('album_role')
            .find(filter)
            .project<{ _id: ObjectId; album: ObjectId; user: ObjectId; userRole: string }>({
              _id: 1,
              album: 1,
              user: 1,
              userRole: 1,
            })
            .sort({ _id: 1 })
            .limit(roleBatchSize)
            .toArray();

          if (roles.length === 0) break;

          const albumIds = [...new Set(roles.map(r => r.album.toHexString()))];
          const memberUserIds = [...new Set(roles.map(r => r.user.toHexString()))];

          const albums = await db
            .collection('album')
            .find({ _id: { $in: albumIds.map(id => new ObjectId(id)) } })
            .project<{ _id: ObjectId; author?: ObjectId }>({ _id: 1, author: 1 })
            .toArray();

          const albumAuthorMap = new Map<string, string>();
          for (const a of albums) {
            if (a.author) {
              albumAuthorMap.set(a._id.toHexString(), a.author.toHexString());
            }
          }

          const users = await db
            .collection('user')
            .find({ _id: { $in: memberUserIds.map(id => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name?: string; email: string }>({ _id: 1, name: 1, email: 1 })
            .toArray();

          const userMap = new Map<string, { name?: string; email: string }>();
          for (const u of users) {
            userMap.set(u._id.toHexString(), { name: u.name, email: u.email });
          }

          for (const role of roles) {
            const albumId = role.album.toHexString();
            const userId = role.user.toHexString();
            const albumAuthor = albumAuthorMap.get(albumId);

            if (userId === albumAuthor) {
              rolesProcessed++;
              continue;
            }

            const user = userMap.get(userId);
            if (!user) {
              rolesProcessed++;
              continue;
            }

            const invite = await db.collection('album_invite').findOne({
              album: role.album,
              inviteKey: user.email.toLowerCase().trim(),
              removed: false,
            });

            if (!invite) {
              rolesProcessed++;
              continue;
            }

            const actorName = user.name || (user.email ? user.email.split('@')[0] : 'Unknown');
            const eventId = `Backfill_AlbumInviteAccepted_${albumId}_${userId}`;
            const createdAt = invite.createdAt || new Date().getTime();

            try {
              await db.collection('activity_event').insertOne({
                _id: new ObjectId(),
                eventId,
                albumId: role.album,
                actorId: role.user,
                actorName,
                verb: 'ACCEPTED',
                targetType: 'INVITE',
                targetId: role.album,
                metadata: {},
                visibleToRoles: ACCEPTED_VISIBLE_ROLES,
                visibleToUserIds: [],
                visibilityVersion: 0,
                createdAt,
              });

              const isoTs = new Date(createdAt).toISOString().substring(0, 23);
              await db.collection('activity_summary').updateOne(
                {
                  albumId: role.album,
                  verb: 'ACCEPTED',
                  actorId: role.user,
                  timeWindow: isoTs,
                },
                {
                  $setOnInsert: {
                    _id: new ObjectId(),
                    albumId: role.album,
                    verb: 'ACCEPTED',
                    actorId: role.user,
                    timeWindow: isoTs,
                    firstEventAt: createdAt,
                    metadata: {},
                  },
                  $set: {
                    lastEventAt: createdAt,
                    actorName,
                    visibleToRoles: ACCEPTED_VISIBLE_ROLES,
                    visibleToUserIds: [],
                  },
                  $addToSet: { eventIds: new ObjectId() },
                  $inc: { count: 1 },
                },
                { upsert: true },
              );

              acceptedCreated++;
            } catch (err: any) {
              if (err.code === 11000) {
                continue;
              }
              throw err;
            }

            rolesProcessed++;
          }

          lastRoleId = roles[roles.length - 1]._id;
          batch++;

          jobLog.info(
            `ACCEPTED batch ${batch}: ${roles.length} roles → events: ${acceptedCreated}`,
          );

          Context.current().heartbeat({
            batch,
            lastRoleId: lastRoleId.toHexString(),
            invitedCreated,
            acceptedCreated,
            invitesProcessed,
            rolesProcessed,
            phase: 'accepted',
          });
        }
      }

      jobLog.success(
        `Completed: ${invitesProcessed} invites → ${invitedCreated} INVITED, ${rolesProcessed} roles → ${acceptedCreated} ACCEPTED`,
      );

      return {
        invitedCreated,
        acceptedCreated,
        invitesProcessed,
        rolesProcessed,
        batches: batch,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('GenerateInviteActivity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
