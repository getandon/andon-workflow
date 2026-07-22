import { Controller, Get, Post, Delete, Param, Body, ParseIntPipe } from '@nestjs/common';
import { WorkersService } from '../services/workers.service';

@Controller('api/workers')
export class WorkersController {
  constructor(private workers: WorkersService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get()
  list() {
    return this.workers.findAll();
  }

  @Post('register')
  register(@Body() body: {
    name: string;
    taskQueue: string;
    environment: string;
    activities: string[];
    activitySchemas?: Array<{
      name: string;
      label: string;
      description: string;
      schema: {
        input: { type: string; properties: Record<string, unknown>; required?: string[] };
        output: { type: string; properties: Record<string, unknown> };
      };
    }>;
    identity?: string;
    tlsEnabled?: boolean;
    temporalTls?: boolean;
    apiTls?: boolean;
    certNotAfter?: string | null;
    certNotBefore?: string | null;
    certSubject?: string | null;
    certIssuer?: string | null;
    certSerial?: string | null;
    certKeyUsage?: string | null;
    certFingerprint?: string | null;
    caNotAfter?: string | null;
    caSubject?: string | null;
  }) {
    return this.workers.register(body);
  }

  @Get('activities')
  listActivities() {
    return this.workers.findAvailableActivities();
  }

  @Post(':name/heartbeat')
  heartbeat(@Param('name') name: string) {
    return this.workers.heartbeatByName(name);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.workers.deleteById(id);
  }
}
