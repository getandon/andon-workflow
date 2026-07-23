import {Injectable} from '@nestjs/common';
import {Context} from '@temporalio/activity';
import {MongoClient, ObjectId} from 'mongodb';
import {GenerateInviteActivityInput, GenerateInviteActivityOutput, requiredEnv, toHex, toObjectId, fetchUserMap, insertActivityEvent, upsertActivitySummary, findUnprocessedBatch, markProcessed} from '@andon-workflow/lib';
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

        let invitedCreated = 0;
        let invitesProcessed = 0;
        let batch = 0;

        while (true) {
            const invites: any[] = await findUnprocessedBatch(db, 'album_invite', inviteBatchSize);

            if (invites.length === 0) break;

            const authorIds = [...new Set(invites.map((i: any) => toHex(i.author)).filter((h: string) => h && h.length === 24))];
            const userMap = await fetchUserMap(db, authorIds);

            const albumObjIds = [...new Set(invites
                .map((i: any) => toObjectId(i.album))
                .filter(Boolean))];
            const publicInviteLinkIds = new Set<string>();
            if (albumObjIds.length > 0) {
                const albumDocs = await db
                    .collection('album')
                    .find({ _id: { $in: albumObjIds } })
                    .project({ _id: 1, publicInviteLinkId: 1 })
                    .toArray();
                for (const a of albumDocs) {
                    if (a.publicInviteLinkId) {
                        publicInviteLinkIds.add(a.publicInviteLinkId.toHexString());
                    }
                }
            }

            for (const invite of invites) {
                const inviteHexId = invite._id.toHexString();
                if (publicInviteLinkIds.has(inviteHexId)) {
                    invitesProcessed++;
                    continue;
                }
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
                    await insertActivityEvent(db, {
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

                    invitedCreated++;

                    const isoTs = new Date(createdAt).toISOString().substring(0, 23);
                    await upsertActivitySummary(
                        db,
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
                                userId: albumObjId,
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
                        eventId,
                        jobLog,
                    );
                } catch (err: any) {
                    if (err.code === 11000) {
                        continue;
                    }
                    throw err;
                }

                invitesProcessed++;
            }

            await markProcessed(db, 'album_invite', invites.map(i => i._id));
            batch++;

            jobLog.info(
                `INVITED batch ${batch}: ${invites.length} invites → events: ${invitedCreated}`,
            );

            Context.current().heartbeat({
                batch,
                invitedCreated,
                invitesProcessed,
            });
        }

        return {invitedCreated, invitesProcessed};
    }

    private async processAccepted(db: any, input: GenerateInviteActivityInput): Promise<{ acceptedCreated: number; rolesProcessed: number }> {
        const roleBatchSize = input.roleBatchSize ?? DEFAULT_ROLE_BATCH_SIZE;

        let acceptedCreated = 0;
        let rolesProcessed = 0;
        let batch = 0;

        while (true) {
            const roles: any[] = await findUnprocessedBatch(db, 'album_role', roleBatchSize);

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

            const userMap = await fetchUserMap(db, memberUserIds);

            for (const role of roles) {
                let albumObjId = toObjectId(role.album);
                let userObjId = toObjectId(role.user);
                if (!albumObjId) albumObjId = new ObjectId('000000000000000000000000');
                if (!userObjId) userObjId = new ObjectId('000000000000000000000000');
                const albumId = toHex(role.album);
                const userId = toHex(role.user);

                if (role.userRole === 'OWNER') {
                    rolesProcessed++;
                    continue;
                }

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
                    await insertActivityEvent(db, {
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

                    acceptedCreated++;

                    const isoTs = new Date(createdAt).toISOString().substring(0, 23);
                    await upsertActivitySummary(
                        db,
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
                                userId: albumObjId,
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
                        eventId,
                        jobLog,
                    );
                } catch (err: any) {
                    if (err.code === 11000) {
                        continue;
                    }
                    throw err;
                }

                rolesProcessed++;
            }

            await markProcessed(db, 'album_role', roles.map(r => r._id));
            batch++;

            jobLog.info(
                `ACCEPTED batch ${batch}: ${roles.length} roles → events: ${acceptedCreated}`,
            );

            Context.current().heartbeat({
                batch,
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
                batches: 0,
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
