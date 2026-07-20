import { Plus, Trash2 } from 'lucide-react';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Checkbox } from '~/components/ui/checkbox';
import { Button } from '~/components/ui/button';
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

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

function labelText(key: string, prop: Record<string, unknown>, required: string[]): string {
  return (prop.title as string) ?? key;
}

function isRequired(key: string, prop: Record<string, unknown>, required: string[]): boolean {
  return required.includes(key) || (prop.minItems as number) !== undefined;
}

function resolveEnum(prop: Record<string, unknown>): string[] | null {
  const directEnum = prop.enum as string[] | undefined;
  if (directEnum && directEnum.length > 0) return directEnum;
  const anyOf = prop.anyOf as Array<{ const?: string }> | undefined;
  if (anyOf) {
    const values = anyOf.map((o) => o.const).filter((v): v is string => typeof v === 'string');
    if (values.length > 0) return values;
  }
  if (prop.type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined;
    if (items) return resolveEnum(items);
  }
  return null;
}

function resolveObjectProperties(prop: Record<string, unknown>): Record<string, unknown> | null {
  if (prop.type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined;
    if (items?.type === 'object' && items?.properties) {
      return items.properties as Record<string, unknown>;
    }
  }
  return null;
}

function resolveArrayItemSchema(prop: Record<string, unknown>): Record<string, unknown> | null {
  if (prop.type === 'array') {
    return (prop.items as Record<string, unknown>) ?? null;
  }
  return null;
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
        const propType = propObj.type as string;
        const override = overrides?.[key];
        const currentValue = value[key];
        const propEnum = resolveEnum(propObj);
        const objectProps = resolveObjectProperties(propObj);
        const arrayItemSchema = resolveArrayItemSchema(propObj);

        return (
          <div key={key} className="flex flex-col gap-1.5">
            <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {labelText(key, propObj, required)}
              {isRequired(key, propObj, required) && <span className="ml-1 text-destructive">*</span>}
              {propObj.description && (
                <span className="block normal-case text-[10px] font-normal tracking-normal text-muted-foreground/60">
                  {propObj.description as string}
                </span>
              )}
            </Label>

            {propType === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm font-mono">
                <Checkbox
                  checked={!!currentValue}
                  onCheckedChange={(v) => update(key, !!v)}
                />
                {propObj.description ?? propObj.title}
              </label>
            ) : override?.options ? (
              <Select
                value={(currentValue as string) ?? ''}
                onValueChange={(v) => update(key, v)}
              >
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder={`Select ${propObj.title ?? key}...`} />
                </SelectTrigger>
                <SelectContent>
                  {override.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="font-mono">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : propEnum && (propType === 'string' || (propType === 'array' && arrayItemSchema?.type === 'string')) ? (
              propType === 'array' ? (
                <MultiSelect
                  options={propEnum}
                  value={(currentValue as string[]) ?? []}
                  onChange={(v) => update(key, v)}
                  placeholder={`Select ${propObj.title ?? key}...`}
                />
              ) : (
                <Select
                  value={(currentValue as string) ?? ''}
                  onValueChange={(v) => update(key, v)}
                >
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder={`Select ${propObj.title ?? key}...`} />
                  </SelectTrigger>
                  <SelectContent>
                    {propEnum.map((opt) => (
                      <SelectItem key={opt} value={opt} className="font-mono">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : objectProps ? (
              <ArrayOfObjectsField
                keyName={key}
                currentValue={(currentValue as Record<string, unknown>[]) ?? []}
                objectProps={objectProps}
                onChange={(v) => update(key, v)}
                title={propObj.title as string}
              />
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
                placeholder={(propObj.description as string) ?? `Enter ${propObj.title ?? key}`}
                className="text-xs font-mono"
              />
            )}
            {propObj.description && propType !== 'boolean' && !objectProps && (
              <p className="text-[10px] text-muted-foreground font-mono">{propObj.description as string}</p>
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

function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const selected = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(
                  selected ? value.filter((v) => v !== opt) : [...value, opt],
                );
              }}
              className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground hover:border-primary/30'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {value.length === 0 && (
        <p className="text-[10px] text-muted-foreground font-mono">{placeholder}</p>
      )}
    </div>
  );
}

function ArrayOfObjectsField({
  keyName,
  currentValue,
  objectProps,
  onChange,
  title,
}: {
  keyName: string;
  currentValue: Record<string, unknown>[];
  objectProps: Record<string, unknown>;
  onChange: (v: Record<string, unknown>[]) => void;
  title: string;
}) {
  const propEntries = Object.entries(objectProps);

  const addRow = () => {
    const newRow: Record<string, unknown> = {};
    for (const [pKey, pProp] of propEntries) {
      const pObj = pProp as Record<string, unknown>;
      if (pObj.type === 'array') {
        newRow[pKey] = [];
      } else if (pObj.type === 'number' || pObj.type === 'integer') {
        newRow[pKey] = 0;
      } else if (pObj.type === 'boolean') {
        newRow[pKey] = false;
      } else {
        newRow[pKey] = '';
      }
    }
    onChange([...currentValue, newRow]);
  };

  const removeRow = (idx: number) => {
    onChange(currentValue.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: string, val: unknown) => {
    onChange(currentValue.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));
  };

  return (
    <div className="flex flex-col gap-2">
      {currentValue.length === 0 && (
        <p className="text-[11px] text-muted-foreground font-mono py-2">
          No {title.toLowerCase()} added yet
        </p>
      )}
      {currentValue.map((row, idx) => (
        <div
          key={idx}
          className="rounded-md border border-border bg-muted/20 p-3 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              {title.replace(/s$/, '')} #{idx + 1}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => removeRow(idx)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {propEntries.map(([pKey, pProp]) => {
              const pObj = pProp as Record<string, unknown>;
              const pType = pObj.type as string;
              const pEnum = resolveEnum(pObj);
              const nestedObjectProps = resolveObjectProperties(pObj);
              const nestedItemSchema = resolveArrayItemSchema(pObj);
              const rowVal = row[pKey];

              if (nestedObjectProps) {
                return (
                  <div key={pKey} className="flex flex-col gap-1">
                    <Label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      {pObj.title as string}
                      {pObj.minItems !== undefined && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    <NestedArrayField
                      value={(rowVal as Record<string, unknown>[]) ?? []}
                      objectProps={nestedObjectProps}
                      onChange={(v) => updateRow(idx, pKey, v)}
                      title={pObj.title as string}
                    />
                  </div>
                );
              }

              return (
                <div key={pKey} className="flex items-center gap-2">
                  <Label className="w-16 shrink-0 text-right font-mono text-[10px] font-medium text-muted-foreground">
                    {pObj.title as string}
                  </Label>
                  <div className="flex-1">
                    {pEnum && (pType === 'string' || (pType === 'array' && nestedItemSchema?.type === 'string')) ? (
                      <Select
                        value={(rowVal as string) ?? ''}
                        onValueChange={(v) => updateRow(idx, pKey, v)}
                      >
                        <SelectTrigger className="h-8 text-xs font-mono">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {pEnum.map((opt) => (
                            <SelectItem key={opt} value={opt} className="text-xs font-mono">
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : pType === 'number' || pType === 'integer' ? (
                      <Input
                        type="number"
                        value={rowVal as number ?? 0}
                        onChange={(e) => updateRow(idx, pKey, Number(e.target.value))}
                        className="h-8 text-xs font-mono"
                      />
                    ) : pType === 'boolean' ? (
                      <Checkbox
                        checked={!!rowVal}
                        onCheckedChange={(v) => updateRow(idx, pKey, !!v)}
                      />
                    ) : (
                      <Input
                        type="text"
                        value={(rowVal as string) ?? ''}
                        onChange={(e) => updateRow(idx, pKey, e.target.value)}
                        placeholder={pObj.title as string}
                        className="h-8 text-xs font-mono"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start gap-1 text-[10px] font-mono uppercase tracking-wider"
        onClick={addRow}
      >
        <Plus className="h-3 w-3" />
        Add {title.replace(/s$/, '')}
      </Button>
    </div>
  );
}

function NestedArrayField({
  value,
  objectProps,
  onChange,
  title,
}: {
  value: Record<string, unknown>[];
  objectProps: Record<string, unknown>;
  onChange: (v: Record<string, unknown>[]) => void;
  title: string;
}) {
  const propEntries = Object.entries(objectProps);

  const addRow = () => {
    const newRow: Record<string, unknown> = {};
    for (const [pKey, pProp] of propEntries) {
      const pObj = pProp as Record<string, unknown>;
      if (pObj.type === 'number' || pObj.type === 'integer') {
        newRow[pKey] = 0;
      } else {
        newRow[pKey] = '';
      }
    }
    onChange([...value, newRow]);
  };

  const removeRow = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, field: string, val: unknown) => {
    onChange(value.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));
  };

  return (
    <div className="flex flex-col gap-1.5">
      {value.map((row, idx) => (
        <div
          key={idx}
          className="flex items-end gap-1.5 rounded-md border border-border/60 bg-muted/10 px-2 py-1.5"
        >
          {propEntries.map(([pKey, pProp]) => {
            const pObj = pProp as Record<string, unknown>;
            const pType = pObj.type as string;
            const pEnum = resolveEnum(pObj);
            const rowVal = row[pKey];

            return (
              <div key={pKey} className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-[8px] uppercase tracking-wider text-muted-foreground/60 font-mono leading-none">
                  {pObj.title as string}
                </span>
                {pEnum ? (
                  <Select
                    value={(rowVal as string) ?? ''}
                    onValueChange={(v) => updateRow(idx, pKey, v)}
                  >
                    <SelectTrigger className="h-7 text-[11px] font-mono">
                      <SelectValue placeholder="-" />
                    </SelectTrigger>
                    <SelectContent>
                      {pEnum.map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-[11px] font-mono">
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : pType === 'number' || pType === 'integer' ? (
                  <Input
                    type="number"
                    value={rowVal as number ?? 0}
                    onChange={(e) => updateRow(idx, pKey, Number(e.target.value))}
                    className="h-7 text-[11px] font-mono"
                  />
                ) : (
                  <Input
                    type="text"
                    value={(rowVal as string) ?? ''}
                    onChange={(e) => updateRow(idx, pKey, e.target.value)}
                    className="h-7 text-[11px] font-mono"
                  />
                )}
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive mb-0.5"
            onClick={() => removeRow(idx)}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start h-6 gap-1 text-[9px] font-mono uppercase tracking-wider"
        onClick={addRow}
      >
        <Plus className="h-2.5 w-2.5" />
        Add {title.replace(/s$/, '').toLowerCase()}
      </Button>
    </div>
  );
}
