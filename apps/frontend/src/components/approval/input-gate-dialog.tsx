import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, X, Send } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '~/components/ui/dialog';
import { DynamicForm } from '~/components/dynamic-form';
import { useApproveGate, useRejectGate, useSubmitGateInput } from '~/hooks/use-jobs';
import { ApiError } from '~/lib/api';
import {
  getSchemaDefaults,
  mapServerErrors,
  validateAgainstSchema,
  type JsonSchemaObject,
} from '~/lib/schema';
import { expiryLabel } from '~/lib/utils';
import type { JobInputRequest } from '~/types';

interface InputGateActionsProps {
  jobId: number;
  gate: JobInputRequest;
  compact?: boolean;
}

function parseSchema(gate: JobInputRequest): JsonSchemaObject | null {
  if (!gate.schema) return null;
  try {
    return JSON.parse(gate.schema) as JsonSchemaObject;
  } catch {
    return null;
  }
}

export function InputGateActions({ jobId, gate }: InputGateActionsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const approve = useApproveGate();
  const reject = useRejectGate();
  const submitInput = useSubmitGateInput();
  const schema = useMemo(() => parseSchema(gate), [gate]);
  const isApproval = gate.kind === 'approval';
  const busy = approve.isPending || reject.isPending || submitInput.isPending;

  const handleApproveClick = async () => {
    if (schema) {
      setDialogOpen(true);
      return;
    }
    try {
      await approve.mutateAsync({ id: jobId, gateId: gate.gateId });
      toast.success('Approved — workflow resuming');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to approve');
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Rejection reason (optional)') ?? undefined;
    try {
      await reject.mutateAsync({ id: jobId, gateId: gate.gateId, reason });
      toast.error('Rejected');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to reject');
    }
  };

  return (
    <span className="ml-1 inline-flex items-center gap-1.5">
      {isApproval ? (
        <>
          <button
            onClick={handleApproveClick}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-[#4ade80] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#0d1f14] hover:bg-[#4ade80]/90 disabled:opacity-40 font-mono"
          >
            <Check className="h-3 w-3" /> Approve
          </button>
          <button
            onClick={handleReject}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20 disabled:opacity-40 font-mono"
          >
            <X className="h-3 w-3" /> Reject
          </button>
        </>
      ) : (
        <button
          onClick={() => setDialogOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-mono"
        >
          <Send className="h-3 w-3" /> Provide Input
        </button>
      )}
      {gate.expiresAt && (
        <span className="text-[10px] uppercase tracking-widest text-warning font-mono">
          {expiryLabel(gate.expiresAt)}
        </span>
      )}
      {schema && (
        <InputGateDialog
          jobId={jobId}
          gate={gate}
          schema={schema}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </span>
  );
}

interface InputGateDialogProps {
  jobId: number;
  gate: JobInputRequest;
  schema: JsonSchemaObject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function InputGateDialog({ jobId, gate, schema, open, onOpenChange }: InputGateDialogProps) {
  const approve = useApproveGate();
  const submitInput = useSubmitGateInput();
  const isApproval = gate.kind === 'approval';

  const [values, setValues] = useState<Record<string, unknown>>(() => getSchemaDefaults(schema));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = approve.isPending || submitInput.isPending;

  const clientErrors = validateAgainstSchema(schema, values);
  const canSubmit = Object.keys(clientErrors).length === 0 && !busy;

  const handleSubmit = async () => {
    const validation = validateAgainstSchema(schema, values);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }
    setErrors({});
    try {
      if (isApproval) {
        await approve.mutateAsync({ id: jobId, gateId: gate.gateId, input: values });
        toast.success('Approved — workflow resuming');
      } else {
        await submitInput.mutateAsync({ id: jobId, gateId: gate.gateId, payload: values });
        toast.success('Input submitted — workflow resuming');
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { errors?: unknown[]; message?: string };
        const mapped = mapServerErrors(body.errors ?? []);
        setErrors(mapped);
        toast.error(body.message ?? 'Input rejected by workflow');
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Failed to submit');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <DialogTitle>
              {schema.title ?? (isApproval ? 'Approve with input' : 'Provide input')}
            </DialogTitle>
            <DialogDescription>
              {gate.step} · {gate.gateId}
              {gate.expiresAt ? ` · ${expiryLabel(gate.expiresAt)}` : ''}
            </DialogDescription>
          </div>

          <DynamicForm
            schema={schema as unknown as Record<string, unknown>}
            value={values}
            onChange={setValues}
            errors={errors}
          />

          {errors[''] && (
            <p className="text-[11px] text-destructive font-mono">{errors['']}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/70 disabled:opacity-40 font-mono"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#4ade80] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#0d1f14] hover:bg-[#4ade80]/90 disabled:opacity-40 font-mono"
            >
              <Check className="h-3.5 w-3.5" />
              {isApproval ? 'Approve' : 'Submit'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
