import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Parses a single query-param token against a zod enum schema, turning an invalid
 * value into a 400 (instead of an unhandled ZodError bubbling up to a 500).
 */
export function parseQueryEnum<T extends string>(schema: z.ZodType<T>, value: string, name: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const options = 'options' in schema ? (schema as unknown as { options: readonly string[] }).options : undefined;
    const allowed = options ? ` (allowed: ${options.join(', ')})` : '';
    throw new BadRequestException(`invalid ${name}: "${value}"${allowed}`);
  }
  return parsed.data;
}

/**
 * Parses a query-param token as a bounded integer, rejecting non-numeric/non-integer
 * input with a 400 instead of letting NaN reach the service/DB layer.
 */
export function parseQueryInt(
  value: string,
  name: string,
  opts: { min?: number; max?: number } = {},
): number {
  const n = value.trim() === '' ? NaN : Number(value);
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`invalid ${name}: "${value}" (must be an integer)`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new BadRequestException(`invalid ${name}: "${value}" (must be >= ${opts.min})`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new BadRequestException(`invalid ${name}: "${value}" (must be <= ${opts.max})`);
  }
  return n;
}
