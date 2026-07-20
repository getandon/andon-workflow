import { defineQuery, scheduleActivity, setHandler } from '@temporalio/workflow';
import { Type } from '@sinclair/typebox';
import type { SetUserPackageItemsByIdentityOutput, WorkflowDefinition } from '../../common/src';
import { requestApprovalOrThrow } from './input-gate';

const currentStepQuery = defineQuery<string | undefined>('currentStep');

export interface PixxoUpdateByIdentityInput {
  database: string;
  taskQueue: string;
  batchSize?: number;
  selectedActivities: string[];
}

const setUserPackagesByIdentitySchema = Type.Object(
  {
    entries: Type.Array(
      Type.Object({
        email: Type.String({ format: 'email', title: 'User Email' }),
        packages: Type.Array(
          Type.Object({
            type: Type.Enum(
              { LIMIT: 'LIMIT', SIZE: 'SIZE', TRAFFIC: 'TRAFFIC', YEAR: 'YEAR' },
              { title: 'Package Type' },
            ),
            quantity: Type.Number({ minimum: 0, title: 'Quantity' }),
            unit: Type.Enum(
              { bytes: 'bytes', KB: 'KB', MB: 'MB', GB: 'GB', TB: 'TB', count: 'count', year: 'year' },
              { title: 'Unit' },
            ),
            mode: Type.Enum(
              { add: 'add', set: 'set', usage_based: 'usage_based' },
              { title: 'Mode' },
            ),
          }),
          { title: 'Packages', minItems: 1 },
        ),
      }),
      { title: 'Users', minItems: 1 },
    ),
  },
  { title: 'Set User Package Items By Identity' },
);

export async function PixxoUpdateByIdentityWorkflow(input: PixxoUpdateByIdentityInput): Promise<void> {
  let currentStep: string | undefined;
  setHandler(currentStepQuery, () => currentStep);

  for (const activity of input.selectedActivities) {
    if (activity === 'setUserPackageItemsByIdentity') {
      currentStep = 'setUserPackageItemsByIdentity';

      const decision = await requestApprovalOrThrow({
        gateId: 'pixxoUpdateByIdentity_setUserPackageItemsByIdentity',
        step: 'setUserPackageItemsByIdentity',
        schema: setUserPackagesByIdentitySchema,
        timeout: '24 hours',
      });

      await scheduleActivity<SetUserPackageItemsByIdentityOutput>(
        'setUserPackageItemsByIdentity',
        [
          {
            database: input.database,
            batchSize: input.batchSize,
            entries: decision.input?.entries ?? [],
          },
        ],
        { taskQueue: input.taskQueue, startToCloseTimeout: '2 hours' },
      );
    }
  }

  currentStep = undefined;
}

const ALL_ACTIVITY_TYPES = ['setUserPackageItemsByIdentity'] as const;

export const workflowDefinition: WorkflowDefinition = {
  type: 'PixxoUpdateByIdentityWorkflow',
  label: 'Pixxo Update By Identity',
  description: 'Update user package items by email with per-user package configuration',
  steps: [...ALL_ACTIVITY_TYPES],
  resolveSteps: (params: Record<string, unknown>) => {
    const selected = (params.selectedActivities as string[]) ?? [];
    return selected.length > 0 ? selected : [];
  },
  taskQueueField: 'taskQueue',
  inputSchema: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        title: 'Target Database',
        description: 'Target database for the pixxo activities',
      },
      taskQueue: {
        type: 'string',
        title: 'Task Queue',
        description: 'Worker queue that runs the pixxo activities',
      },
      batchSize: {
        type: 'number',
        title: 'Batch Size',
        description: 'Users per batch (default: 50)',
      },
      selectedActivities: {
        type: 'array',
        title: 'Activities',
        description: 'Select activities to run',
        items: {
          type: 'string',
          enum: ALL_ACTIVITY_TYPES,
        },
        uniqueItems: true,
      },
    },
    required: ['taskQueue', 'selectedActivities'],
  },
};
