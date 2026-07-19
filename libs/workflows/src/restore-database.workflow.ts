import {defineQuery, scheduleActivity, setHandler} from '@temporalio/workflow';
import type {WorkflowDefinition} from '../../common/src';

const currentStepQuery = defineQuery<string | undefined>('currentStep');

export interface RestoreDatabaseInput {
    targetDb: string;
    s3Url: string;
    taskQueue: string;
}

export async function RestoreDatabaseWorkflow(input: RestoreDatabaseInput): Promise<void> {
    let currentStep: string | undefined;
    setHandler(currentStepQuery, () => currentStep);

    currentStep = 'restoreDatabase';
    await scheduleActivity<void>(
        'restoreDatabase',
        [{backupLocation: input.s3Url, database: input.targetDb}],
        {taskQueue: input.taskQueue, startToCloseTimeout: '1 hour'},
    );

    currentStep = undefined;
}

export const workflowDefinition: WorkflowDefinition = {
    type: 'RestoreDatabaseWorkflow',
    label: 'Restore Database',
    description: 'Restore a MongoDB database from an S3 backup',
    steps: ['restoreDatabase'],
    taskQueueField: 'taskQueue',
    inputSchema: {
        type: 'object',
        properties: {
            targetDb: {
                type: 'string',
                title: 'Target Database',
                description: 'Name of the database to restore into',
            },
            s3Url: {
                type: 'string',
                title: 'S3 Backup URL',
                description: 'S3 URI of the backup archive (e.g. s3://bucket/path/backup.dump)',
            },
            taskQueue: {
                type: 'string',
                title: 'Task Queue',
                description: 'Worker queue for the restore activity',
            },
        },
        required: ['targetDb', 's3Url', 'taskQueue'],
    },
};
