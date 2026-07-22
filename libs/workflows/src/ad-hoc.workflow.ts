import { defineQuery, scheduleActivity, setHandler, proxyActivities } from '@temporalio/workflow';
import type { WorkflowDefinition } from '../../common/src';
import { requestApprovalOrThrow } from './input-gate';

const currentStepQuery = defineQuery<string | undefined>('currentStep');

export interface AdHocActivity {
  name: string;
  params: Record<string, unknown>;
  taskQueue: string;
}

export interface AdHocWorkflowInput {
  activities: AdHocActivity[];
  shared?: Record<string, unknown>;
}

const OUTPUT_REF_REGEX = /\$\{([\w]+)\.([\w]+)\}/g;

function resolveRefs(
  params: Record<string, unknown>,
  outputs: Map<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      resolved[key] = value.replace(OUTPUT_REF_REGEX, (_match, activityName, field) => {
        const output = outputs.get(activityName);
        if (output && typeof output === 'object' && output !== null) {
          return String((output as Record<string, unknown>)[field] ?? '');
        }
        return _match;
      });
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

export async function AdHocWorkflow(input: AdHocWorkflowInput): Promise<void> {
  let currentStep: string | undefined;
  setHandler(currentStepQuery, () => currentStep);

  const outputs = new Map<string, unknown>();
  const activities = input.activities;

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const stepLabel = `${activity.name}${i + 1}`;

    currentStep = `awaitApproval_${stepLabel}`;
    await requestApprovalOrThrow({
      gateId: `adHoc_${i}_${activity.name}`,
      step: currentStep,
      timeout: '24 hours',
    });

    currentStep = `run_${stepLabel}`;
    const resolvedParams = resolveRefs(
      { ...(input.shared ?? {}), ...activity.params },
      outputs,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await scheduleActivity<any>(
      activity.name as any,
      [resolvedParams],
      { taskQueue: activity.taskQueue, startToCloseTimeout: '8 hours' },
    );

    if (result !== undefined && result !== null) {
      outputs.set(activity.name, result);
    }
  }

  currentStep = undefined;
}

export const workflowDefinition: WorkflowDefinition = {
  type: 'AdHocWorkflow',
  label: 'Ad-Hoc / Composable Workflow',
  description: 'Select one or more activities to run sequentially with per-activity approval gates and data flow via ${activity.field} references',
  steps: [],
  resolveSteps: (params) => {
    const input = params as unknown as AdHocWorkflowInput;
    if (!input?.activities) return [];
    const steps: string[] = [];
    input.activities.forEach((a, i) => {
      steps.push(`awaitApproval_${a.name}${i + 1}`);
      steps.push(`run_${a.name}${i + 1}`);
    });
    return steps;
  },
  taskQueueField: 'taskQueue',
  inputSchema: {
    type: 'object',
    properties: {
      activities: {
        type: 'array',
        title: 'Activities',
        description: 'List of activities to run in order',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Activity Name' },
            taskQueue: { type: 'string', title: 'Task Queue' },
            params: { type: 'object', title: 'Activity Parameters' },
          },
          required: ['name', 'taskQueue'],
        },
      },
      shared: {
        type: 'object',
        title: 'Shared Parameters',
        description: 'Common parameters applied to all activities (e.g. database, batchSize)',
      },
    },
    required: ['activities'],
  },
};
