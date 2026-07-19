import { Injectable } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import {
  TEMPORAL_DEFAULT_ADDRESS,
  buildTemporalTls,
  temporalNamespace,
} from '@andon-workflow/lib';

@Injectable()
export class TemporalService {
  private client: Client;

  async onModuleInit() {
    const address = process.env.TEMPORAL_ADDRESS ?? TEMPORAL_DEFAULT_ADDRESS;
    const connection = await Connection.connect({
      address,
      tls: buildTemporalTls(),
      apiKey: process.env.TEMPORAL_API_KEY,
    });
    this.client = new Client({ connection, namespace: temporalNamespace() });
  }

  getClient(): Client {
    return this.client;
  }

  async describeTaskQueue(taskQueue: string) {
    return this.client.workflowService.describeTaskQueue({
      namespace: temporalNamespace(),
      taskQueue: { name: taskQueue },
      taskQueueType: 1,
    });
  }
}
