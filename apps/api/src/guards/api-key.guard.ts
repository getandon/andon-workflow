import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path === '/api/workers/health') {
      return true;
    }
    const header = request.headers['authorization'];
    if (!header) {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const expected = process.env.API_KEY;
    if (!expected) {
      if (process.env.AUTH_DISABLED === 'true') {
        return true;
      }
      throw new UnauthorizedException('API_KEY is not configured on the server');
    }
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (token !== expected) {
      throw new UnauthorizedException('Invalid API key');
    }
    return true;
  }
}
