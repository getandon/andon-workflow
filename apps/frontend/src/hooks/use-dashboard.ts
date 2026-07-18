import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DashboardData } from '../types';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/api/jobs'), // TODO: dedicated dashboard endpoint
    refetchInterval: 15_000,
  });
}
