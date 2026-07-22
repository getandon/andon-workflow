import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';

export interface ApiWorker {
  id: number;
  name: string;
  environment: string;
  taskQueue: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  lastHeartbeat: string | null;
  lastHeartbeatSec: number | null;
  activities: string[] | { name: string; label: string; description: string; schema: unknown }[];
  tlsEnabled: boolean;
  temporalTls: boolean;
  apiTls: boolean;
  certNotAfter: string | null;
  certNotBefore: string | null;
  certSubject: string | null;
  certIssuer: string | null;
  certSerial: string | null;
  certKeyUsage: string[] | null;
  certFingerprint: string | null;
  caNotAfter: string | null;
  caSubject: string | null;
}

export function useWorkers() {
  return useQuery({
    queryKey: ['workers'],
    queryFn: () => api<ApiWorker[]>('/api/workers'),
    refetchInterval: 5_000,
  });
}

export function useDeleteWorker() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      api<void>(`/api/workers/${id}`, { method: 'DELETE' }),
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: ['workers'] });
      const prev = qc.getQueryData<ApiWorker[]>(['workers']);
      qc.setQueryData<ApiWorker[]>(['workers'], (old: ApiWorker[] | undefined) =>
        old?.filter((w: ApiWorker) => w.id !== id) ?? [],
      );
      return { prev };
    },
    onError: (_err: Error, _id: number, ctx: { prev: ApiWorker[] | undefined } | undefined) => {
      if (ctx?.prev) qc.setQueryData(['workers'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
    },
  });
}
