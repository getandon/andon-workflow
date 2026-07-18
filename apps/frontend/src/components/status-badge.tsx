import { Badge } from '~/components/ui';

const statusConfig: Record<string, { variant: 'success' | 'destructive' | 'warning' | 'info' | 'secondary'; label: string }> = {
  RUNNING: { variant: 'info', label: 'Running' },
  WAITING_APPROVAL: { variant: 'warning', label: 'Waiting Approval' },
  WAITING_INPUT: { variant: 'warning', label: 'Waiting Input' },
  COMPLETED: { variant: 'success', label: 'Completed' },
  FAILED: { variant: 'destructive', label: 'Failed' },
  CANCELLED: { variant: 'secondary', label: 'Cancelled' },
  TIMEOUT: { variant: 'destructive', label: 'Timeout' },
  PENDING: { variant: 'secondary', label: 'Pending' },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { variant: 'secondary' as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
