import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { WorkflowType } from '../types';

export function useWorkflows() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => api<WorkflowType[]>('/api/workflows'),
    staleTime: 5 * 60 * 1000,
  });
}
