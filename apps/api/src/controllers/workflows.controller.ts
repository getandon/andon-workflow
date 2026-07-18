import { Controller, Get } from '@nestjs/common';
import { WORKFLOW_REGISTRY } from '../../../../libs/workflows/src';

@Controller('api/workflows')
export class WorkflowsController {
  @Get()
  list() {
    return WORKFLOW_REGISTRY.map((w) => ({
      type: w.type,
      label: w.label,
      description: w.description,
      steps: w.steps,
      inputSchema: w.inputSchema,
    }));
  }
}
