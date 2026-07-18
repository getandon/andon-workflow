import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { connectSocket, getSocket } from '../lib/socket';
import type { Job, JobLogEntry } from '../types';

interface JobFilters {
  status?: string;
  limit?: string;
  offset?: string;
}

export function useJobs(filters?: JobFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.limit) params.set('limit', filters.limit);
  if (filters?.offset) params.set('offset', filters.offset);
  const qs = params.toString();

  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => api<Job[]>(`/api/jobs${qs ? `?${qs}` : ''}`),
    refetchInterval: 30_000,
  });
}

export function useJob(id: number) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => api<Job>(`/api/jobs/${id}`),
    refetchInterval: 15_000,
  });
}

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { workflowType: string; params?: Record<string, unknown> }) =>
      api<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<Job>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', id] }); },
  });
}

export function useApproveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<Job>(`/api/jobs/${id}/approve`, { method: 'POST' }),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', id] }); },
  });
}

export function useRejectJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      api<Job>(`/api/jobs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', vars.id] }); },
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<Job>(`/api/jobs/${id}/retry`, { method: 'POST' }),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', id] }); },
  });
}

export function useApproveGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, gateId, input }: { id: number; gateId: string; input?: Record<string, unknown> }) =>
      api<Job>(`/api/jobs/${id}/gates/${gateId}/approve`, { method: 'POST', body: JSON.stringify({ input }) }),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', vars.id] }); },
  });
}

export function useRejectGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, gateId, reason }: { id: number; gateId: string; reason?: string }) =>
      api<Job>(`/api/jobs/${id}/gates/${gateId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', vars.id] }); },
  });
}

export function useSubmitGateInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, gateId, payload }: { id: number; gateId: string; payload: Record<string, unknown> }) =>
      api<Job>(`/api/jobs/${id}/inputs/${gateId}`, { method: 'POST', body: JSON.stringify({ payload }) }),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['jobs'] }); qc.invalidateQueries({ queryKey: ['job', vars.id] }); },
  });
}

export function useJobHistory(id: number) {
  return useQuery({
    queryKey: ['job-history', id],
    queryFn: () => api<unknown[]>(`/api/jobs/${id}/history`),
  });
}

export function useJobLogs(id: number, enabled = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    connectSocket();
    const socket = getSocket();
    const handler = (data: { jobId: number; entry: JobLogEntry }) => {
      if (data.jobId !== id || !data.entry) return;
      qc.setQueryData<JobLogEntry[]>(['job-logs', id], (prev) => {
        if (!prev) return prev;
        if (prev.some((e) => e.id === data.entry.id)) return prev;
        return [...prev, data.entry];
      });
    };
    socket.on('job:log', handler);
    return () => {
      socket.off('job:log', handler);
    };
  }, [id, enabled, qc]);

  return useQuery({
    queryKey: ['job-logs', id],
    queryFn: () => api<JobLogEntry[]>(`/api/jobs/${id}/logs`),
    enabled,
  });
}
