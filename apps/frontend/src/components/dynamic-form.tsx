import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

interface FieldOverride {
  options?: { label: string; value: string }[];
}

interface DynamicFormProps {
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  overrides?: Record<string, FieldOverride>;
  errors?: Record<string, string>;
}

export function DynamicForm({ schema, value, onChange, overrides, errors }: DynamicFormProps) {
  const properties = (schema.properties as Record<string, unknown>) ?? {};
  const required = (schema.required as string[]) ?? [];

  const update = (key: string, val: unknown) => {
    onChange({ ...value, [key]: val });
  };

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(properties).map(([key, prop]) => {
        const propObj = prop as Record<string, unknown>;
        const title = (propObj.title as string) ?? key;
        const description = propObj.description as string | undefined;
        const propType = propObj.type as string;
        const isRequired = required.includes(key);
        const override = overrides?.[key];

        const currentValue = value[key];

        return (
          <div key={key} className="flex flex-col gap-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {title}
              {isRequired && <span className="ml-1 text-destructive">*</span>}
            </Label>

            {propType === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm font-mono">
                <Checkbox
                  checked={!!currentValue}
                  onCheckedChange={(v) => update(key, !!v)}
                />
                {description ?? title}
              </label>
            ) : override?.options ? (
              <Select
                value={(currentValue as string) ?? ''}
                onValueChange={(v) => update(key, v)}
              >
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder={`Select ${title}...`} />
                </SelectTrigger>
                <SelectContent>
                  {override.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="font-mono">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : propType === 'array' ? (
              <Input
                value={((currentValue as string[]) ?? []).join(', ')}
                onChange={(e) =>
                  update(
                    key,
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="Comma-separated values"
                className="text-xs font-mono"
              />
            ) : (
              <Input
                type={propType === 'number' ? 'number' : 'text'}
                value={(currentValue as string | number) ?? ''}
                onChange={(e) =>
                  update(key, propType === 'number' ? Number(e.target.value) : e.target.value)
                }
                placeholder={description ?? `Enter ${title}`}
                className="text-xs font-mono"
              />
            )}
            {errors?.[key] && (
              <p className="text-[11px] text-destructive font-mono">{errors[key]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
