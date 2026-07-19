import { workflowDefinition as CopyDatabase } from './copy-database.workflow';
import { workflowDefinition as PixxoRecalculation } from './pixxo-recalculation.workflow';

export const WORKFLOW_REGISTRY = [
  CopyDatabase,
  PixxoRecalculation,
];
