import { useState, useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { PlayCircle } from 'lucide-react';

import { useStartJob } from '~/hooks/use-jobs';
import { useWorkflows } from '~/hooks/use-workflows';
import { useWorkers } from '~/hooks/use-workers';
import { DynamicForm } from '~/components/dynamic-form';
import { validateAgainstSchema, type JsonSchemaObject } from '~/lib/schema';
import { Card } from '~/components/ui/card';
import { Label } from '~/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

export const Route = createFileRoute('/jobs/create')({
  head: () => ({
    meta: [
      { title: 'Start Job — Andon' },
      { name: 'description', content: 'Kick off a new Temporal workflow.' },
    ],
  }),
  component: CreateJob,
});

function CreateJob() {
  const navigate = useNavigate();
  const { data: workflows } = useWorkflows();
  const { data: workers } = useWorkers();
  const startJob = useStartJob();

  const [selectedType, setSelectedType] = useState('');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const selectedWorkflow = useMemo(
    () => workflows?.find((w) => w.type === selectedType),
    [workflows, selectedType],
  );

  const taskQueueOptions = useMemo(() => {
    if (!workers) return [];
    const queues = [...new Set(workers.map((w) => w.taskQueue))];
    return queues.map((q) => ({ label: q, value: q }));
  }, [workers]);

  const submit = async () => {
    if (!selectedType || !selectedWorkflow) {
      toast.error('Select a workflow type.');
      return;
    }
    const errors = validateAgainstSchema(
      selectedWorkflow.inputSchema as JsonSchemaObject,
      formValues,
    );
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error('Fill in the required fields.');
      return;
    }
    try {
      const result = await startJob.mutateAsync({
        workflowType: selectedType,
        params: formValues,
      });
      toast.success('Job queued — awaiting approval');
      navigate({ to: '/jobs/$jobId', params: { jobId: String(result.id) } });
    } catch {
      toast.error('Failed to start job');
    }
  };

  const operations = workflows ?? [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Start new job</h1>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          configure workflow parameters
        </p>
      </div>

      <Card className="flex flex-col gap-5 rounded-md border-border bg-card p-6">
        <div className="flex flex-col gap-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Workflow Type <span className="ml-1 text-destructive">*</span>
          </Label>
          <Select
            value={selectedType}
            onValueChange={(v) => {
              setSelectedType(v);
              setFormValues({});
              setFormErrors({});
            }}
          >
            <SelectTrigger className="font-mono">
              <SelectValue placeholder="Select workflow..." />
            </SelectTrigger>
            <SelectContent>
              {operations.map((w) => (
                <SelectItem key={w.type} value={w.type} className="font-mono">
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWorkflow && (
            <p className="text-[11px] text-muted-foreground font-mono">
              {selectedWorkflow.description}
            </p>
          )}
        </div>

        {selectedWorkflow && (
          <DynamicForm
            schema={selectedWorkflow.inputSchema}
            value={formValues}
            onChange={(values) => {
              setFormValues(values);
              if (Object.keys(formErrors).length > 0) {
                setFormErrors(
                  validateAgainstSchema(selectedWorkflow.inputSchema as JsonSchemaObject, values),
                );
              }
            }}
            errors={formErrors}
            overrides={{
              sourceTaskQueue: { options: taskQueueOptions },
              targetTaskQueue: { options: taskQueueOptions },
            }}
          />
        )}

        {!selectedWorkflow && (
          <p className="py-4 text-center text-[11px] uppercase tracking-widest text-muted-foreground font-mono">
            Select a workflow type to configure parameters
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => navigate({ to: '/jobs' })}
            className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/70 font-mono"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!selectedType || startJob.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40 font-mono"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Start Job
          </button>
        </div>
      </Card>
    </div>
  );
}
