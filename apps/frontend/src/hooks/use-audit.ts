import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AuditLog } from '../types';

export function useAuditLog(filters?: { action?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (filters?.action) params.set('action', filters.action);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();

  return useQuery({
    queryKey: ['audit', filters],
    queryFn: () => api<AuditLog[]>(`/api/audit${qs ? `?${qs}` : ''}`),
  });
}
