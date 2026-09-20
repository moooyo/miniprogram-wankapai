export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly field?: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function requireValue(condition: unknown, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new DomainError(code, message, field);
}
