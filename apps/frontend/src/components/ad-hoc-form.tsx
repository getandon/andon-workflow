import { useState, useEffect, useCallback } from 'react';
import { GripVertical, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '~/lib/api';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Checkbox } from '~/components/ui/checkbox';
import { Card } from '~/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

export interface ActivitySchemaEntry {
  name: string;
  label: string;
  description: string;
  schema: {
    input: { type: string; properties: Record<string, unknown>; required?: string[] };
    output: { type: string; properties: Record<string, unknown> };
  };
  taskQueues: string[];
}

export interface SelectedActivity {
  name: string;
  label: string;
  params: Record<string, unknown>;
  taskQueue: string;
  schema: ActivitySchemaEntry['schema'];
}

interface AdHocFormProps {
  value: { activities: SelectedActivity[]; shared: Record<string, unknown> };
  onChange: (value: { activities: SelectedActivity[]; shared: Record<string, unknown> }) => void;
  taskQueueOptions: { label: string; value: string }[];
  errors?: Record<string, string>;
}

let cachedActivities: ActivitySchemaEntry[] | null = null;

export function AdHocForm({ value, onChange, taskQueueOptions, errors }: AdHocFormProps) {
  const [availableActivities, setAvailableActivities] = useState<ActivitySchemaEntry[]>(cachedActivities ?? []);
  const [loading, setLoading] = useState(!cachedActivities);

  useEffect(() => {
    if (cachedActivities) return;
    api<ActivitySchemaEntry[]>('/api/workers/activities')
      .then((data) => {
        cachedActivities = data;
        setAvailableActivities(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selectedNames = new Set(value.activities.map((a) => a.name));

  const toggleActivity = useCallback((entry: ActivitySchemaEntry) => {
    const isSelected = selectedNames.has(entry.name);
    if (isSelected) {
      onChange({
        ...value,
        activities: value.activities.filter((a) => a.name !== entry.name),
      });
    } else {
      const newActivity: SelectedActivity = {
        name: entry.name,
        label: entry.label,
        params: {},
        taskQueue: entry.taskQueues[0] ?? '',
        schema: entry.schema,
      };
      onChange({
        ...value,
        activities: [...value.activities, newActivity],
      });
    }
  }, [value, onChange, selectedNames]);

  const moveActivity = useCallback((fromIndex: number, toIndex: number) => {
    const activities = [...value.activities];
    const [removed] = activities.splice(fromIndex, 1);
    activities.splice(toIndex, 0, removed);
    onChange({ ...value, activities });
  }, [value, onChange]);

  const updateActivityParam = useCallback((index: number, paramKey: string, paramVal: unknown) => {
    const activities = [...value.activities];
    activities[index] = {
      ...activities[index],
      params: { ...activities[index].params, [paramKey]: paramVal },
    };
    onChange({ ...value, activities });
  }, [value, onChange]);

  const updateActivityTaskQueue = useCallback((index: number, taskQueue: string) => {
    const activities = [...value.activities];
    activities[index] = { ...activities[index], taskQueue };
    onChange({ ...value, activities });
  }, [value, onChange]);

  const updateShared = useCallback((key: string, val: unknown) => {
    onChange({ ...value, shared: { ...value.shared, [key]: val } });
  }, [value, onChange]);

  if (loading) {
    return <p className="py-8 text-center text-[11px] uppercase tracking-widest text-muted-foreground font-mono">Loading available activities...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Available Activities
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {availableActivities.map((entry) => {
            const selected = selectedNames.has(entry.name);
            return (
              <button
                key={entry.name}
                type="button"
                onClick={() => toggleActivity(entry)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-mono transition-colors text-left ${
                  selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted text-muted-foreground hover:border-primary/30'
                }`}
                title={entry.description}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        {availableActivities.length === 0 && (
          <p className="text-[11px] text-muted-foreground font-mono">No activities available from online workers</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Shared Parameters
          <span className="block normal-case text-[10px] font-normal tracking-normal text-muted-foreground/60">
            These values are applied to all selected activities (can be overridden per activity)
          </span>
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Database
            </Label>
            <Input
              value={(value.shared.database as string) ?? ''}
              onChange={(e) => updateShared('database', e.target.value)}
              placeholder="MongoDB database name"
              className="text-xs font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Batch Size
            </Label>
            <Input
              type="number"
              value={(value.shared.batchSize as number | string) ?? ''}
              onChange={(e) => updateShared('batchSize', Number(e.target.value) || undefined)}
              placeholder="Default batch size"
              className="text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {value.activities.length > 0 && (
        <div className="flex flex-col gap-3">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Selected Activities ({value.activities.length})
            <span className="block normal-case text-[10px] font-normal tracking-normal text-muted-foreground/60">
              Drag to reorder — activities run in this order
            </span>
          </Label>
          {value.activities.map((activity, index) => (
            <ActivityConfigCard
              key={`${activity.name}-${index}`}
              activity={activity}
              index={index}
              total={value.activities.length}
              onParamChange={(key, val) => updateActivityParam(index, key, val)}
              onTaskQueueChange={(q) => updateActivityTaskQueue(index, q)}
              onMoveUp={() => index > 0 && moveActivity(index, index - 1)}
              onMoveDown={() => index < value.activities.length - 1 && moveActivity(index, index + 1)}
              onRemove={() => onChange({ ...value, activities: value.activities.filter((_, i) => i !== index) })}
              sharedParams={value.shared}
              taskQueueOptions={taskQueueOptions}
            />
          ))}
        </div>
      )}

      {errors?.['activities'] && (
        <p className="text-[11px] text-destructive font-mono">{errors['activities']}</p>
      )}
    </div>
  );
}

function ActivityConfigCard({
  activity,
  index,
  total,
  onParamChange,
  onTaskQueueChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  sharedParams,
  taskQueueOptions,
}: {
  activity: SelectedActivity;
  index: number;
  total: number;
  onParamChange: (key: string, val: unknown) => void;
  onTaskQueueChange: (q: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  sharedParams: Record<string, unknown>;
  taskQueueOptions: { label: string; value: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const inputProps = activity.schema.input.properties;
  const inputRequired = activity.schema.input.required ?? [];
  const outputProps = activity.schema.output.properties;

  const paramEntries = Object.entries(inputProps).filter(([key]) => {
    return key !== 'database' && key !== 'batchSize';
  });

  return (
    <Card className="rounded-md border-border bg-card p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <div className="flex items-center gap-1.5 text-muted-foreground">
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="hover:text-foreground disabled:opacity-30">
            <GripVertical className="h-3 w-3" />
          </button>
        </div>

        <span className="flex-1 font-mono text-xs font-semibold">{activity.label}</span>

        <span className="text-[10px] font-mono text-muted-foreground/60">
          {index + 1}/{total}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded p-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            &darr;
          </button>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-0.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            &uarr;
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-muted"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 pl-6">
          <div className="flex flex-col gap-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Task Queue <span className="ml-1 text-destructive">*</span>
            </Label>
            <Select
              value={activity.taskQueue}
              onValueChange={onTaskQueueChange}
            >
              <SelectTrigger className="font-mono text-xs">
                <SelectValue placeholder="Select task queue..." />
              </SelectTrigger>
              <SelectContent>
                {taskQueueOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="font-mono text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paramEntries.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Activity Parameters
              </Label>
              {paramEntries.map(([key, prop]) => {
                const propObj = prop as Record<string, unknown>;
                const propType = propObj.type as string;
                const paramVal = activity.params[key] ?? sharedParams[key] ?? propObj.default;
                const required = inputRequired.includes(key);

                return (
                  <div key={key} className="flex items-center gap-2">
                    <Label className="w-28 shrink-0 text-right font-mono text-[10px] font-medium text-muted-foreground">
                      {propObj.title as string ?? key}
                      {required && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    <div className="flex-1">
                      {propType === 'boolean' ? (
                        <Checkbox
                          checked={!!paramVal}
                          onCheckedChange={(v) => onParamChange(key, !!v)}
                        />
                      ) : propType === 'number' || propType === 'integer' ? (
                        <Input
                          type="number"
                          value={(paramVal as number) ?? ''}
                          onChange={(e) => onParamChange(key, e.target.value === '' ? undefined : Number(e.target.value))}
                          className="h-7 text-xs font-mono"
                        />
                      ) : propType === 'array' ? (
                        <Input
                          type="text"
                          value={Array.isArray(paramVal) ? (paramVal as string[]).join(', ') : ((paramVal as string) ?? '')}
                          onChange={(e) => onParamChange(key, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                          placeholder={(propObj.description as string) ?? `Enter ${key}`}
                          className="h-7 text-xs font-mono"
                        />
                      ) : (
                        <Input
                          type="text"
                          value={(paramVal as string) ?? ''}
                          onChange={(e) => onParamChange(key, e.target.value === '' ? undefined : e.target.value)}
                          placeholder={propObj.title as string ?? key}
                          className="h-7 text-xs font-mono"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {outputProps && Object.keys(outputProps).length > 0 && (
            <div className="flex flex-col gap-1">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Output Fields (available for ${'{activity.field}'} references)
              </Label>
              <div className="flex flex-wrap gap-1">
                {Object.entries(outputProps).map(([key, prop]) => {
                  const propObj = prop as Record<string, unknown>;
                  return (
                    <code key={key} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      $&#123;{activity.name}.{key}&#125;
                    </code>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
