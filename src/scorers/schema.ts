import { Ajv } from 'ajv';

export interface SchemaResult {
  passed: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, strict: false, verbose: false });

export function evaluateSchema(schema: unknown, value: unknown): SchemaResult {
  const validate = ajv.compile(schema as object);
  const ok = validate(value);
  if (ok) return { passed: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || '$'} ${e.message ?? 'is invalid'}`,
  );
  return { passed: false, errors };
}
