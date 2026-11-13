import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseQueryEnum, parseQueryInt } from './query-parse';

const StatusSchema = z.enum(['queued', 'approved']);

describe('parseQueryEnum', () => {
  it('returns the parsed value for a valid token', () => {
    expect(parseQueryEnum(StatusSchema, 'queued', 'status')).toBe('queued');
  });

  it('throws BadRequestException naming the param and allowed values for an invalid token', () => {
    try {
      parseQueryEnum(StatusSchema, 'bogus', 'status');
      expect.unreachable('expected parseQueryEnum to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const message = (err as BadRequestException).message;
      expect(message).toContain('status');
      expect(message).toContain('bogus');
      expect(message).toContain('queued');
      expect(message).toContain('approved');
    }
  });
});

describe('parseQueryInt', () => {
  it('parses a valid integer', () => {
    expect(parseQueryInt('42', 'limit')).toBe(42);
  });

  it('rejects non-numeric input with a 400', () => {
    expect(() => parseQueryInt('not_a_number', 'limit')).toThrow(BadRequestException);
  });

  it('rejects non-integer (NaN-producing or fractional) input', () => {
    expect(() => parseQueryInt('3.5', 'limit')).toThrow(BadRequestException);
    expect(() => parseQueryInt('', 'limit')).toThrow(BadRequestException);
  });

  it('enforces min/max bounds', () => {
    expect(() => parseQueryInt('0', 'limit', { min: 1, max: 200 })).toThrow(BadRequestException);
    expect(() => parseQueryInt('201', 'limit', { min: 1, max: 200 })).toThrow(BadRequestException);
    expect(parseQueryInt('200', 'limit', { min: 1, max: 200 })).toBe(200);
  });
});
