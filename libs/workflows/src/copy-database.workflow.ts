import {defineQuery, scheduleActivity, setHandler} from '@temporalio/workflow';
import {Type} from '@sinclair/typebox';
import type {BackupResult, VerifyResult, WorkflowDefinition} from '../../common/src';
import {requestApprovalOrThrow} from './input-gate';

const currentStepQuery = defineQuery<string | undefined>('currentStep');

export interface CopyDatabaseInput {
    sourceDb: string;
    targetDb: string;
    verifyCollections?: string[];
    sourceTaskQueue: string;
    targetTaskQueue: string;
    requireRestoreApproval?: boolean;
    verifyDatabase?: boolean;
    runMigration?: boolean;
}

export async function CopyDatabaseWorkflow(input: CopyDatabaseInput): Promise<void> {
    let currentStep: string | undefined;
    setHandler(currentStepQuery, () => currentStep);

    currentStep = 'backupDatabase';
    const backup = await scheduleActivity<BackupResult>(
        'backupDatabase',
        [{database: input.sourceDb}],
        {taskQueue: input.sourceTaskQueue, startToCloseTimeout: '1 hour'},
    );

    let verifyCollections = input.verifyCollections ?? ['users', 'projects', 'settings'];

    if (input.requireRestoreApproval) {
        currentStep = 'awaitApproval';
        const restoreApprovalSchema = input.verifyDatabase
            ? Type.Object(
                {
                    verifyCollections: Type.Optional(
                        Type.Array(Type.String(), {
                            title: 'Collections to Verify',
                            description: 'Collections checked after the restore completes',
                            default: verifyCollections,
                        }),
                    ),
                },
                {title: 'Restore Options'},
            )
            : undefined;

        const decision = await requestApprovalOrThrow({
            gateId: 'restoreApproval',
            step: 'awaitApproval',
            schema: restoreApprovalSchema,
            timeout: '24 hours',
        });
        if (decision.input?.verifyCollections?.length) {
            verifyCollections = decision.input.verifyCollections;
        }
    }

    currentStep = 'restoreDatabase';
    await scheduleActivity<void>(
        'restoreDatabase',
        [{backupLocation: backup.location, database: input.targetDb}],
        {taskQueue: input.targetTaskQueue, startToCloseTimeout: '1 hour'},
    );

    if (input.runMigration) {
        currentStep = 'runMigration';
        await scheduleActivity<void>(
            'runMigration',
            [{database: input.targetDb}],
            {taskQueue: input.targetTaskQueue, startToCloseTimeout: '1 hour'},
        );
    }

    if (input.verifyDatabase) {
        currentStep = 'verifyDatabase';
        await scheduleActivity<VerifyResult>(
            'verifyDatabase',
            [{database: input.targetDb, collections: verifyCollections}],
            {taskQueue: input.targetTaskQueue, startToCloseTimeout: '1 hour'},
        );
    }

    currentStep = undefined;
}

export const workflowDefinition: WorkflowDefinition = {
    type: 'CopyDatabaseWorkflow',
    label: 'Copy Database',
    description: 'Backup source database, restore to target, run migrations, verify',
    steps: ['backupDatabase', 'awaitApproval', 'restoreDatabase', 'runMigration', 'verifyDatabase'],
    resolveSteps: (params) =>
        ['backupDatabase', 'awaitApproval', 'restoreDatabase', 'runMigration', 'verifyDatabase']
            .filter((step) => step !== 'awaitApproval' || Boolean(params.requireRestoreApproval))
            .filter(step => step !== 'runMigration' || Boolean(params.runMigration))
            .filter(step => step !== 'verifyDatabase' || Boolean(params.verifyDatabase))
    ,
    taskQueueField: 'sourceTaskQueue',
    inputSchema: {
        type: 'object',
        properties: {
            sourceDb: {type: 'string', title: 'Source Database', description: 'Name of the source database'},
            targetDb: {type: 'string', title: 'Target Database', description: 'Name of the target database'},
            sourceTaskQueue: {
                type: 'string',
                title: 'Source Task Queue',
                description: 'Worker queue for backup/source activities'
            },
            targetTaskQueue: {
                type: 'string',
                title: 'Target Task Queue',
                description: 'Worker queue for restore/target activities'
            },
            requireRestoreApproval: {
                type: 'boolean',
                title: 'Require approval before restore',
                description: 'Pause after the backup and wait for a human decision before writing to the target',
            },
            verifyDatabase: {
                type: 'boolean',
                title: 'Verify Database',
                description: 'Verify the database after restore',
            },
            runMigration: {
                type: 'boolean',
                title: 'Run Migration',
                description: 'Run migration after restore',
            },
            verifyCollections: {
                type: 'array',
                items: {type: 'string'},
                title: 'Collections to Verify',
                description: 'Optional list of collections to verify',
            },
        },
        required: ['sourceDb', 'targetDb', 'sourceTaskQueue', 'targetTaskQueue'],
    },
};
