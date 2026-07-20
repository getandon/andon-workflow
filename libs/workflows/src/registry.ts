import { workflowDefinition as CopyDatabase } from './copy-database.workflow';
import { workflowDefinition as PixxoRecalculation } from './pixxo-recalculation.workflow';
import { workflowDefinition as PixxoUpdate } from './pixxo-update.workflow';
import { workflowDefinition as RestoreDatabase } from './restore-database.workflow';

export const WORKFLOW_REGISTRY = [
  CopyDatabase,
  PixxoRecalculation,
  PixxoUpdate,
  RestoreDatabase,
];
