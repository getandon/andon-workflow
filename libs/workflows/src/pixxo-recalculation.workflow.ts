import { defineQuery, scheduleActivity, setHandler } from '@temporalio/workflow';
import type { MarkUserAsLegacyOutput, CalculateUserPackageUsageOutput, CalculateAlbumSummaryOutput, WorkflowDefinition } from '../../common/src';
import { requestApprovalOrThrow } from './input-gate';

const currentStepQuery = defineQuery<string | undefined>('currentStep');

export interface PixxoRecalculationInput {
  database?: string;
  taskQueue: string;
  markLegacyBatchSize?: number;
  packageUsageBatchSize?: number;
  albumSummaryBatchSize?: number;
}

export async function PixxoRecalculationWorkflow(input: PixxoRecalculationInput): Promise<void> {
  let currentStep: string | undefined;
  setHandler(currentStepQuery, () => currentStep);

  currentStep = 'awaitApproval';
  await requestApprovalOrThrow({
    gateId: 'pixxoApproval',
    step: 'awaitApproval',
    timeout: '24 hours',
  });

  currentStep = 'runRecalculations';
  await Promise.all([
    scheduleActivity<MarkUserAsLegacyOutput>(
      'markUserAsLegacy',
      [{ database: input.database, batchSize: input.markLegacyBatchSize }],
      { taskQueue: input.taskQueue, startToCloseTimeout: '2 hours' },
    ),
    scheduleActivity<CalculateUserPackageUsageOutput>(
      'calculateUserPackageUsage',
      [{ database: input.database, batchSize: input.packageUsageBatchSize }],
      { taskQueue: input.taskQueue, startToCloseTimeout: '4 hours' },
    ),
    scheduleActivity<CalculateAlbumSummaryOutput>(
      'calculateAlbumSummary',
      [{ database: input.database, batchSize: input.albumSummaryBatchSize }],
      { taskQueue: input.taskQueue, startToCloseTimeout: '4 hours' },
    ),
  ]);

  currentStep = undefined;
}

export const workflowDefinition: WorkflowDefinition = {
  type: 'PixxoRecalculationWorkflow',
  label: 'Pixxo Recalculation',
  description: 'Mark users as legacy, recalculate package usage, and recalculate album summaries — all in parallel after approval',
  steps: ['awaitApproval', 'runRecalculations'],
  taskQueueField: 'taskQueue',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        title: 'Database',
        description: 'MongoDB database name (defaults to pixo)',
      },
      taskQueue: {
        type: 'string',
        title: 'Task Queue',
        description: 'Worker queue that runs the pixxo activities',
      },
      markLegacyBatchSize: {
        type: 'number',
        title: 'Mark Legacy Batch Size',
        description: 'Users per batch for MarkUserAsLegacy (default: 500)',
      },
      packageUsageBatchSize: {
        type: 'number',
        title: 'Package Usage Batch Size',
        description: 'Users per batch for CalculateUserPackageUsage (default: 10)',
      },
      albumSummaryBatchSize: {
        type: 'number',
        title: 'Album Summary Batch Size',
        description: 'Albums per batch for CalculateAlbumSummary (default: 50)',
      },
    },
    required: ['taskQueue'],
  },
};
