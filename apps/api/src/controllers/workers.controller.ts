import { Controller, Get, Post, Param, Body } from '@nestjs/common';
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
  register(@Body() body: { name: string; taskQueue: string; environment: string; activities: string[]; identity?: string }) {
    return this.workers.register(body);
  }

  @Post(':name/heartbeat')
  heartbeat(@Param('name') name: string) {
    return this.workers.heartbeatByName(name);
  }
}
