export interface JsonSchemaObject {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minItems?: number;
  items?: JsonSchemaObject;
  default?: unknown;
  enum?: string[];
}

export interface JsonSchemaProperty extends JsonSchemaObject {}

export function getSchemaDefaults(schema: JsonSchemaObject): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.default !== undefined) {
      values[key] = prop.default;
    }
  }
  return values;
}

function isEmptyValue(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

export function validateAgainstSchema(
  schema: JsonSchemaObject,
  value: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [key, v] of Object.entries(value)) {
    const prop = schema.properties?.[key];
    if (!prop) continue;

    if (schema.required?.includes(key) && isEmptyValue(v)) {
      errors[key] = 'Required';
      continue;
    }
    if (v === undefined || v === null) continue;

    const propErrors = validateValue(prop, v);
    if (propErrors) errors[key] = propErrors;
  }

  return errors;
}

function validateValue(schema: JsonSchemaObject, v: unknown): string | null {
  switch (schema.type) {
    case 'number':
    case 'integer':
      if (typeof v !== 'number' || Number.isNaN(v)) return 'Must be a number';
      if (schema.type === 'integer' && !Number.isInteger(v)) return 'Must be an integer';
      break;
    case 'boolean':
      if (typeof v !== 'boolean') return 'Must be a boolean';
      break;
    case 'string':
      if (typeof v !== 'string') return 'Must be a string';
      break;
    case 'array':
      if (!Array.isArray(v)) return 'Must be a list';
      if (schema.minItems !== undefined && v.length < schema.minItems) {
        return `At least ${schema.minItems} item${schema.minItems > 1 ? 's' : ''} required`;
      }
      if (schema.items) {
        for (let i = 0; i < v.length; i++) {
          const itemErr = validateValue(schema.items, v[i]);
          if (itemErr) return `Item ${i + 1}: ${itemErr}`;
        }
      }
      break;
    case 'object':
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'Must be an object';
      if (schema.properties) {
        for (const [propKey, propSchema] of Object.entries(schema.properties)) {
          const propVal = (v as Record<string, unknown>)[propKey];
          if (schema.required?.includes(propKey) && isEmptyValue(propVal)) {
            return `"${propKey}" is required`;
          }
          if (propVal !== undefined && propVal !== null) {
            const propErr = validateValue(propSchema, propVal);
            if (propErr) return `"${propKey}": ${propErr}`;
          }
        }
      }
      break;
  }
  return null;
}

export function mapServerErrors(errors: unknown[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const err of errors) {
    if (typeof err !== 'string') continue;
    const match = err.match(/^\/(\w+)[^:]*:\s*(.*)$/);
    if (match) mapped[match[1]] = match[2];
    else mapped[''] = err;
  }
  return mapped;
}
