export interface JsonSchemaObject {
  type?: string;
  title?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  items?: { type?: string };
}

export function getSchemaDefaults(schema: JsonSchemaObject): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.default !== undefined) values[key] = prop.default;
  }
  return values;
}

export function validateAgainstSchema(
  schema: JsonSchemaObject,
  value: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};

  for (const key of required) {
    const v = value[key];
    const isEmpty =
      v === undefined ||
      v === null ||
      (typeof v === 'string' && v.trim() === '') ||
      (Array.isArray(v) && v.length === 0);
    if (isEmpty) errors[key] = 'Required';
  }

  for (const [key, prop] of Object.entries(properties)) {
    if (errors[key]) continue;
    const v = value[key];
    if (v === undefined || v === null) continue;
    switch (prop.type) {
      case 'number':
      case 'integer':
        if (typeof v !== 'number' || Number.isNaN(v)) errors[key] = 'Must be a number';
        else if (prop.type === 'integer' && !Number.isInteger(v)) errors[key] = 'Must be an integer';
        break;
      case 'boolean':
        if (typeof v !== 'boolean') errors[key] = 'Must be a boolean';
        break;
      case 'string':
        if (typeof v !== 'string') errors[key] = 'Must be a string';
        break;
      case 'array':
        if (!Array.isArray(v)) errors[key] = 'Must be a list';
        break;
    }
  }

  return errors;
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
