import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';

const BASE_URL = import.meta.env.VITE_API_URL || '';

export function useWorkerUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = io(`${BASE_URL}/workers`, {
      transports: ['websocket', 'polling'],
    });

    socket.on('worker:update', () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
    });

    socket.on('worker:delete', ({ id }: { id: number }) => {
      qc.setQueryData<{ id: number; name: string }[]>(['workers'], (old: { id: number; name: string }[] | undefined) =>
        old?.filter((w: { id: number }) => w.id !== id) ?? [],
      );
    });

    return () => {
      socket.off('worker:update');
      socket.off('worker:delete');
      socket.disconnect();
    };
  }, [qc]);
}
