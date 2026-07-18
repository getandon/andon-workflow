import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/api';

export interface ApiWorker {
  id: number;
  name: string;
  environment: string;
  taskQueue: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  lastHeartbeat: string | null;
  lastHeartbeatSec: number | null;
  activities: string[];
}

export function useWorkers() {
  return useQuery({
    queryKey: ['workers'],
    queryFn: () => api<ApiWorker[]>('/api/workers'),
    refetchInterval: 5_000,
  });
}
