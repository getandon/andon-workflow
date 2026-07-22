import {Injectable} from '@nestjs/common';
import {Context} from '@temporalio/activity';
import {MongoClient, ObjectId} from 'mongodb';
import {GenerateInviteActivityInput, GenerateInviteActivityOutput, requiredEnv, toHex, toObjectId} from '@andon-workflow/lib';
import {jobLog} from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_INVITE_BATCH_SIZE = 100;
const DEFAULT_ROLE_BATCH_SIZE = 100;

const INVITED_VISIBLE_ROLES = ['OWNER', 'MANAGER'];
const ACCEPTED_VISIBLE_ROLES = ['OWNER', 'MANAGER'];

@Injectable()
export class GenerateInviteActivity {

    private async processInvited(db: any, input: GenerateInviteActivityInput): Promise<{ invitedCreated: number; invitesProcessed: number }> {
        const inviteBatchSize = input.inviteBatchSize ?? DEFAULT_INVITE_BATCH_SIZE;
        let lastInviteId: ObjectId | null = input.lastInviteId
            ? new ObjectId(input.lastInviteId)
            : null;

        let invitedCreated = 0;
        let invitesProcessed = 0;
        let batch = 0;

        while (true) {
            const filter: any = lastInviteId
                ? {_id: {$gt: lastInviteId}}
                : {};

            const invites = await db
                .collection('album_invite')
                .find(filter)
                .project({
                    _id: 1,
                    album: 1,
                    author: 1,
                    inviteKey: 1,
                    createdAt: 1,
                })
                .sort({_id: 1})
                .limit(inviteBatchSize)
                .toArray();

            if (invites.length === 0) break;

            const authorIds = [...new Set(invites.map((i: any) => toHex(i.author)).filter((h: string) => h && h.length === 24))];
            const users = authorIds.length > 0
                ? await db
                    .collection('user')
                    .find({_id: {$in: authorIds.map((id: string) => new ObjectId(id))}})
                    .project({_id: 1, name: 1, email: 1})
                    .toArray()
                : [];

            const userMap = new Map<string, { name?: string; email: string }>();
            for (const u of users) {
                userMap.set(u._id.toHexString(), {name: u.name, email: u.email});
            }

            for (const invite of invites) {
                let authorObjId = toObjectId(invite.author);
                let albumObjId = toObjectId(invite.album);
                if (!authorObjId) authorObjId = new ObjectId('000000000000000000000000');
                if (!albumObjId) albumObjId = new ObjectId('000000000000000000000000');
                const actorHex = toHex(invite.author);
                const user = userMap.get(actorHex);
                const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

                const eventId = `Backfill_AlbumInvitesCreated_${invite._id.toHexString()}`;
                const createdAt = Number(invite.createdAt) || invite._id.getTimestamp().getTime();

                try {
                    const eventObjId = new ObjectId();
                    await db.collection('activity_event').insertOne({
                        _id: eventObjId,
                        eventId,
                        albumId: albumObjId,
                        actorId: authorObjId,
                        actorName,
                        verb: 'INVITED',
                        targetType: 'INVITE',
                        targetId: albumObjId,
                        metadata: {inviteCount: 1, invitees: [invite.inviteKey]},
                        visibleToRoles: INVITED_VISIBLE_ROLES,
                        visibleToUserIds: [],
                        visibilityVersion: 0,
                        createdAt,
                    });

                    const isoTs = new Date(createdAt).toISOString().substring(0, 23);
                    await db.collection('activity_summary').updateOne(
                        {
                            albumId: albumObjId,
                            verb: 'INVITED',
                            actorId: authorObjId,
                            timeWindow: isoTs,
                        },
                        {
                            $setOnInsert: {
                                _id: new ObjectId(),
                                albumId: albumObjId,
                                verb: 'INVITED',
                                actorId: authorObjId,
                                timeWindow: isoTs,
                                firstEventAt: createdAt,
                                metadata: {inviteCount: 1, invitees: [invite.inviteKey]},
                            },
                            $set: {
                                lastEventAt: createdAt,
                                actorName,
                                visibleToRoles: INVITED_VISIBLE_ROLES,
                                visibleToUserIds: [],
                            },
                            $addToSet: {eventIds: eventObjId},
                            $inc: {count: 1},
                        },
                        {upsert: true},
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
                lastInviteId: lastInviteId!.toHexString(),
                invitedCreated,
            });
        }

        return {invitedCreated, invitesProcessed};
    }

    private async processAccepted(db: any, input: GenerateInviteActivityInput): Promise<{ acceptedCreated: number; rolesProcessed: number }> {
        const roleBatchSize = input.roleBatchSize ?? DEFAULT_ROLE_BATCH_SIZE;
        let lastRoleId: ObjectId | null = input.lastRoleId
            ? new ObjectId(input.lastRoleId)
            : null;

        let acceptedCreated = 0;
        let rolesProcessed = 0;
        let batch = 0;

        while (true) {
            const filter: any = lastRoleId ? {_id: {$gt: lastRoleId}} : {};

            const roles = await db
                .collection('album_role')
                .find(filter)
                .project({
                    _id: 1,
                    album: 1,
                    user: 1,
                    userRole: 1,
                    createdAt: 1,
                })
                .sort({_id: 1})
                .limit(roleBatchSize)
                .toArray();

            if (roles.length === 0) break;

            const albumIds = [...new Set(roles.map((r: any) => toHex(r.album)).filter((h: string) => h && h.length === 24))];
            const memberUserIds = [...new Set(roles.map((r: any) => toHex(r.user)).filter((h: string) => h && h.length === 24))];

            const albums = await db
                .collection('album')
                .find({_id: {$in: albumIds.map((id: string) => new ObjectId(id))}})
                .project({_id: 1, author: 1})
                .toArray();

            const albumAuthorMap = new Map<string, string>();
            for (const a of albums) {
                if (a.author) {
                    albumAuthorMap.set(a._id.toHexString(), toHex(a.author));
                }
            }

            const users = await db
                .collection('user')
                .find({_id: {$in: memberUserIds.map((id: string) => new ObjectId(id))}})
                .project({_id: 1, name: 1, email: 1})
                .toArray();

            const userMap = new Map<string, { name?: string; email?: string }>();
            for (const u of users) {
                userMap.set(u._id.toHexString(), {name: u.name, email: u.email});
            }

            for (const role of roles) {
                let albumObjId = toObjectId(role.album);
                let userObjId = toObjectId(role.user);
                if (!albumObjId) albumObjId = new ObjectId('000000000000000000000000');
                if (!userObjId) userObjId = new ObjectId('000000000000000000000000');
                const albumId = toHex(role.album);
                const userId = toHex(role.user);
                const albumAuthor = albumAuthorMap.get(albumId);

                if (userId === albumAuthor) {
                    rolesProcessed++;
                    continue;
                }

                const user = userMap.get(userId);
                const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

                const createdAt = Number(role.createdAt) || role._id.getTimestamp().getTime();
                const eventId = `Backfill_AlbumInviteAccepted_${albumId}_${userId}`;

                try {
                    const eventObjId = new ObjectId();
                    await db.collection('activity_event').insertOne({
                        _id: eventObjId,
                        eventId,
                        albumId: albumObjId,
                        actorId: userObjId,
                        actorName,
                        verb: 'ACCEPTED',
                        targetType: 'INVITE',
                        targetId: albumObjId,
                        metadata: {},
                        visibleToRoles: ACCEPTED_VISIBLE_ROLES,
                        visibleToUserIds: [],
                        visibilityVersion: 0,
                        createdAt,
                    });

                    const isoTs = new Date(createdAt).toISOString().substring(0, 23);
                    await db.collection('activity_summary').updateOne(
                        {
                            albumId: albumObjId,
                            verb: 'ACCEPTED',
                            actorId: userObjId,
                            timeWindow: isoTs,
                        },
                        {
                            $setOnInsert: {
                                _id: new ObjectId(),
                                albumId: albumObjId,
                                verb: 'ACCEPTED',
                                actorId: userObjId,
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
                            $addToSet: {eventIds: eventObjId},
                            $inc: {count: 1},
                        },
                        {upsert: true},
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
                lastRoleId: lastRoleId!.toHexString(),
                acceptedCreated,
                rolesProcessed,
            });
        }

        return {acceptedCreated, rolesProcessed};
    }

    async generateInviteActivity(
        input: GenerateInviteActivityInput = {},
    ): Promise<GenerateInviteActivityOutput> {
        const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
        const mongoUri = requiredEnv('MONGODB_URI');

        const client = new MongoClient(mongoUri, {authSource: database});

        let invitedCreated = 0;
        let acceptedCreated = 0;
        let invitesProcessed = 0;
        let rolesProcessed = 0;
        let batch = 0;

        try {
            await client.connect();
            const db = client.db(database);

            const result1 = await this.processInvited(db, input);
            invitedCreated = result1.invitedCreated;
            invitesProcessed = result1.invitesProcessed;

            const result2 = await this.processAccepted(db, input);
            acceptedCreated = result2.acceptedCreated;
            rolesProcessed = result2.rolesProcessed;

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