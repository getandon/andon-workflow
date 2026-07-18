import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineUpdate,
  setHandler,
} from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';
import { msToNumber } from '@temporalio/common';
import type { Static, TObject } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type {
  ApprovalResult,
  InputGateKind,
  InputSubmission,
  PendingInputRequest,
} from '../../common/src/interfaces/input-gate.interface';
import {
  PENDING_INPUT_REQUESTS_QUERY_NAME,
  SUBMIT_INPUT_UPDATE_NAME,
} from '../../common/src/interfaces/input-gate.interface';

export const submitInputUpdate = defineUpdate<InputSubmission, [InputSubmission]>(
  SUBMIT_INPUT_UPDATE_NAME,
);
export const pendingInputRequestsQuery = defineQuery<PendingInputRequest[]>(
  PENDING_INPUT_REQUESTS_QUERY_NAME,
);

interface OpenGate {
  gateId: string;
  kind: InputGateKind;
  step: string;
  schema?: TObject;
  expiresAt?: string;
  submission?: InputSubmission;
}

const openGates = new Map<string, OpenGate>();
let handlersRegistered = false;

function schemaErrors(schema: TObject, payload: unknown): string[] {
  return [...Value.Errors(schema, payload)].map((e) => `${e.path || '/'}: ${e.message}`);
}

function validateSubmission(submission: InputSubmission): void {
  const gate = openGates.get(submission.gateId);
  if (!gate) {
    throw ApplicationFailure.create({
      message: `No open input gate with id "${submission.gateId}"`,
      type: 'GateNotOpen',
      nonRetryable: true,
    });
  }
  if (gate.kind === 'approval') {
    if (typeof submission.approved !== 'boolean') {
      throw ApplicationFailure.create({
        message: `Gate "${gate.gateId}" is an approval gate: "approved" must be a boolean`,
        type: 'InvalidSubmission',
        nonRetryable: true,
      });
    }
    if (submission.approved && gate.schema) {
      const errors = schemaErrors(gate.schema, submission.payload ?? {});
      if (errors.length > 0) {
        throw ApplicationFailure.create({
          message: `Input for gate "${gate.gateId}" failed schema validation`,
          type: 'SchemaValidationFailed',
          nonRetryable: true,
          details: errors,
        });
      }
    }
    return;
  }
  if (!gate.schema) {
    throw ApplicationFailure.create({
      message: `Gate "${gate.gateId}" has no schema registered`,
      type: 'InvalidGate',
      nonRetryable: true,
    });
  }
  const errors = schemaErrors(gate.schema, submission.payload);
  if (errors.length > 0) {
    throw ApplicationFailure.create({
      message: `Input for gate "${gate.gateId}" failed schema validation`,
      type: 'SchemaValidationFailed',
      nonRetryable: true,
      details: errors,
    });
  }
}

function ensureHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  setHandler(pendingInputRequestsQuery, () =>
    [...openGates.values()]
      .filter((gate) => gate.submission === undefined)
      .map((gate) => ({
        gateId: gate.gateId,
        kind: gate.kind,
        step: gate.step,
        schema: gate.schema ? (JSON.parse(JSON.stringify(gate.schema)) as Record<string, unknown>) : undefined,
        expiresAt: gate.expiresAt,
      })),
  );

  setHandler(
    submitInputUpdate,
    (submission) => {
      const gate = openGates.get(submission.gateId);
      if (!gate || gate.submission !== undefined) {
        throw ApplicationFailure.create({
          message: `No open input gate with id "${submission.gateId}"`,
          type: 'GateNotOpen',
          nonRetryable: true,
        });
      }
      gate.submission = submission;
      return submission;
    },
    { validator: validateSubmission },
  );
}

function openGate(opts: {
  gateId: string;
  kind: InputGateKind;
  step: string;
  schema?: TObject;
  timeout?: Duration;
}): OpenGate {
  ensureHandlers();
  if (openGates.has(opts.gateId)) {
    throw ApplicationFailure.create({
      message: `Input gate "${opts.gateId}" is already registered`,
      type: 'DuplicateGate',
      nonRetryable: true,
    });
  }
  const gate: OpenGate = {
    gateId: opts.gateId,
    kind: opts.kind,
    step: opts.step,
    schema: opts.schema,
    expiresAt:
      opts.timeout !== undefined
        ? new Date(Date.now() + msToNumber(opts.timeout)).toISOString()
        : undefined,
  };
  openGates.set(opts.gateId, gate);
  return gate;
}

async function awaitGate(gate: OpenGate, timeout?: Duration): Promise<InputSubmission> {
  try {
    if (timeout !== undefined) {
      const signalled = await condition(() => gate.submission !== undefined, timeout);
      if (!signalled) {
        throw ApplicationFailure.create({
          message: `Input gate "${gate.gateId}" timed out after ${timeout}`,
          type: 'GateTimeout',
          nonRetryable: true,
        });
      }
    } else {
      await condition(() => gate.submission !== undefined);
    }
    return gate.submission!;
  } finally {
    openGates.delete(gate.gateId);
  }
}

export async function requestInput<S extends TObject>(opts: {
  gateId: string;
  step: string;
  schema: S;
  timeout?: Duration;
}): Promise<Static<S>> {
  const gate = openGate({ ...opts, kind: 'input' });
  const submission = await awaitGate(gate, opts.timeout);
  return submission.payload as Static<S>;
}

export async function requestApproval<S extends TObject>(opts: {
  gateId: string;
  step: string;
  schema?: S;
  timeout?: Duration;
}): Promise<ApprovalResult<Static<S>>> {
  const gate = openGate({ ...opts, kind: 'approval' });
  const submission = await awaitGate(gate, opts.timeout);
  return {
    approved: submission.approved === true,
    decidedBy: submission.decidedBy,
    reason: submission.reason,
    input: submission.approved && opts.schema ? (submission.payload as Static<S>) : undefined,
  };
}

export async function requestApprovalOrThrow<S extends TObject>(opts: {
  gateId: string;
  step: string;
  schema?: S;
  timeout?: Duration;
}): Promise<ApprovalResult<Static<S>>> {
  const result = await requestApproval(opts);
  if (!result.approved) {
    throw ApplicationFailure.create({
      message: `Rejected${result.decidedBy ? ` by ${result.decidedBy}` : ''}: ${result.reason ?? 'no reason given'}`,
      type: 'ApprovalRejected',
      nonRetryable: true,
    });
  }
  return result;
}
