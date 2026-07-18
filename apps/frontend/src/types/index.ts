export interface JobStep {
  id: number;
  jobId: number;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'WAITING_APPROVAL' | 'WAITING_INPUT' | 'COMPLETED' | 'FAILED';
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface JobInputRequest {
  id: number;
  jobId: number;
  gateId: string;
  kind: 'input' | 'approval';
  step: string;
  schema: string | null;
  status: 'OPEN' | 'RESOLVED' | 'REJECTED' | 'EXPIRED';
  payload: string | null;
  decidedBy: string | null;
  reason: string | null;
  openedAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
}

export interface Job {
  id: number;
  workflowId: string;
  workflowType: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'WAITING_APPROVAL' | 'TIMEOUT';
  createdBy: string;
  params: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: JobStep[];
  inputRequests?: JobInputRequest[];
}

export interface AuditLog {
  id: number;
  jobId: number | null;
  job: { id: number; workflowId: string; workflowType: string } | null;
  action: string;
  details: string;
  createdAt: string;
}

export interface JobLogEntry {
  id: number;
  jobId: number;
  ts: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  source: string;
  step: string | null;
  message: string;
}

export interface DashboardData {
  stats: {
    active: number;
    completedToday: number;
    failed: number;
    waiting: number;
  };
  recentActivity: AuditLog[];
}

export interface WorkflowType {
  type: string;
  label: string;
  description: string;
  steps: string[];
  inputSchema: Record<string, unknown>;
}
