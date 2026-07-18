import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/jobs', cors: true })
export class JobsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`WS client disconnected: ${client.id}`);
  }

  emitJobUpdate(jobId: number, payload: Record<string, unknown>) {
    this.server.emit('job:update', { jobId, ...payload });
  }

  emitJobCreated(data: Record<string, unknown>) {
    this.server.emit('job:created', data);
  }

  emitJobLog(jobId: number, entry: Record<string, unknown>) {
    this.server.emit('job:log', { jobId, entry });
  }
}
