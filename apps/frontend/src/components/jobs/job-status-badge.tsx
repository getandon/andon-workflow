import { Badge } from '~/components/ui';

const statusConfig: Record<string, { variant: 'success' | 'destructive' | 'warning' | 'info' | 'secondary' | 'default'; label: string }> = {
  RUNNING: { variant: 'info', label: 'Running' },
  COMPLETED: { variant: 'success', label: 'Completed' },
  FAILED: { variant: 'destructive', label: 'Failed' },
  CANCELLED: { variant: 'secondary', label: 'Cancelled' },
  WAITING_APPROVAL: { variant: 'warning', label: 'Waiting Approval' },
  TIMEOUT: { variant: 'destructive', label: 'Timeout' },
};

export function JobStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { variant: 'default' as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
