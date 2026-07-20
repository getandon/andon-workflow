import { defineQuery, scheduleActivity, setHandler } from '@temporalio/workflow';
import { Type } from '@sinclair/typebox';
import type { HydrateUserNamesFromEmailOutput, SetUserPackageItemsOutput, WorkflowDefinition } from '../../common/src';
import { requestApprovalOrThrow } from './input-gate';

const currentStepQuery = defineQuery<string | undefined>('currentStep');

export interface PixxoUpdateInput {
  taskQueue: string;
  batchSize?: number;
}

const ONE_GB = 1073741824;

const approvalSchema = Type.Object(
  {
    hydrateUserNamesFromEmail: Type.Optional(
      Type.Boolean({
        title: 'Hydrate User Names from Email',
        description: 'Set name from email prefix for users with null names',
        default: true,
      }),
    ),
    setUserPackageItems: Type.Optional(
      Type.Boolean({
        title: 'Set User Package Items',
        description: `Upgrade legacy users: +1000 limit, +1 GB storage, +10 GB traffic, +1 year`,
        default: true,
      }),
    ),
  },
  { title: 'Pixxo Update Options' },
);

export async function PixxoUpdateWorkflow(input: PixxoUpdateInput): Promise<void> {
  let currentStep: string | undefined;
  setHandler(currentStepQuery, () => currentStep);

  currentStep = 'awaitApproval';
  const decision = await requestApprovalOrThrow({
    gateId: 'pixxoUpdateApproval',
    step: 'awaitApproval',
    schema: approvalSchema,
    timeout: '24 hours',
  });

  if (decision.input?.hydrateUserNamesFromEmail) {
    currentStep = 'hydrateUserNamesFromEmail';
    await scheduleActivity<HydrateUserNamesFromEmailOutput>(
      'hydrateUserNamesFromEmail',
      [{ batchSize: input.batchSize }],
      { taskQueue: input.taskQueue, startToCloseTimeout: '2 hours' },
    );
  }

  if (decision.input?.setUserPackageItems) {
    currentStep = 'setUserPackageItems';
    await scheduleActivity<SetUserPackageItemsOutput>(
      'setUserPackageItems',
      [{
        batchSize: input.batchSize,
        limitQuantity: 1000,
        sizeQuantity: ONE_GB,
        trafficQuantity: ONE_GB * 10,
        yearQuantity: 1,
      }],
      { taskQueue: input.taskQueue, startToCloseTimeout: '2 hours' },
    );
  }

  currentStep = undefined;
}

export const workflowDefinition: WorkflowDefinition = {
  type: 'PixxoUpdateWorkflow',
  label: 'Pixxo Update',
  description: 'Approve and run pixxo database maintenance activities',
  steps: ['awaitApproval', 'hydrateUserNamesFromEmail', 'setUserPackageItems'],
  taskQueueField: 'taskQueue',
  inputSchema: {
    type: 'object',
    properties: {
      taskQueue: {
        type: 'string',
        title: 'Task Queue',
        description: 'Worker queue that runs the pixxo activities',
      },
      batchSize: {
        type: 'number',
        title: 'Batch Size',
        description: 'Users per batch (default: 500)',
      },
    },
    required: ['taskQueue'],
  },
};
