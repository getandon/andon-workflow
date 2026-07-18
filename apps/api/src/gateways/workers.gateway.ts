import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/workers', cors: true })
export class WorkersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Workers WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Workers WS client disconnected: ${client.id}`);
  }

  emitWorkerUpdate(payload: { name: string; status: string; lastHeartbeatSec: number | null }) {
    this.server.emit('worker:update', payload);
  }
}
