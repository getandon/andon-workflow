export class StartDatabaseCopyDto {
  sourceDb!: string;
  targetDb!: string;
  verifyCollections?: string[];
}

export class WorkflowStatusResponse {
  workflowId!: string;
  status!: string;
}

export class CancelResponse {
  workflowId!: string;
  status!: string;
}
