export const SUBMIT_INPUT_UPDATE_NAME = 'submitInput';
export const PENDING_INPUT_REQUESTS_QUERY_NAME = 'pendingInputRequests';

export type InputGateKind = 'input' | 'approval';

export type InputRequestStatus = 'OPEN' | 'RESOLVED' | 'REJECTED' | 'EXPIRED';

export interface PendingInputRequest {
  gateId: string;
  kind: InputGateKind;
  step: string;
  schema?: Record<string, unknown>;
  expiresAt?: string;
}

export interface InputSubmission {
  gateId: string;
  payload?: unknown;
  approved?: boolean;
  reason?: string;
  decidedBy?: string;
}

export interface ApprovalResult<T = unknown> {
  approved: boolean;
  decidedBy?: string;
  reason?: string;
  input?: T;
}
