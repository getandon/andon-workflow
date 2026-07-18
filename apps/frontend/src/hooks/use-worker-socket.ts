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

    return () => {
      socket.off('worker:update');
      socket.disconnect();
    };
  }, [qc]);
}
