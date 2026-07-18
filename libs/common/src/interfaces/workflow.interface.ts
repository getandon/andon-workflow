export interface WorkflowDefinition {
  type: string;
  label: string;
  description: string;
  steps: string[];
  resolveSteps?: (params: Record<string, unknown>) => string[];
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  taskQueueField?: string;
  defaultTaskQueue?: string;
}

export interface CopyDatabaseInput {
  sourceDb: string;
  targetDb: string;
  verifyCollections?: string[];
  sourceTaskQueue: string;
  targetTaskQueue: string;
}
