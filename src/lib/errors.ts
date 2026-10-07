export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'VERIFICATION_FAILED'
  | 'RATE_LIMITED'
  | 'LIMIT_EXCEEDED';
  
export class ProvenanceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

export function positiveInteger(
  value: number,
  name: string,
  max = 100000,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new TypeError(`Invalid ${name}`);
  return value;
}

export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProvenanceError('UNAVAILABLE', 'Malformed npm metadata');

  return value as Record<string, any>;
}
