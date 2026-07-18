import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import type { Job } from '../types';

export function useJobUpdates() {
  const qc = useQueryClient();

  useEffect(() => {
    connectSocket();
    const socket = getSocket();

    socket.on('job:update', (data: { jobId: number; status: string; error?: string }) => {
      qc.invalidateQueries({ queryKey: ['job', data.jobId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    });

    socket.on('job:created', () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    });

    return () => {
      socket.off('job:update');
      socket.off('job:created');
      disconnectSocket();
    };
  }, [qc]);
}
