import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { AuditService } from '../services/audit.service';

@Controller('api/audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(@Query() filters?: { action?: string; limit?: string; offset?: string }) {
    return this.audit.findAll({
      action: filters?.action,
      limit: filters?.limit ? parseInt(filters.limit, 10) : undefined,
      offset: filters?.offset ? parseInt(filters.offset, 10) : undefined,
    });
  }
}
