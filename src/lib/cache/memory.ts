import type { Cache } from './cache.js';
import { positiveInteger } from '../errors.js';

export class MemoryCache<T> implements Cache<T> {
  private readonly values = new Map<string, { value: T; expires: number }>();

  constructor(
    private readonly capacity = 1000,
    private readonly now = Date.now,
  ) {
    positiveInteger(capacity, 'cache capacity');
  }
  
  async get(key: string): Promise<T | undefined> {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return structuredClone(entry.value);
  }
  
  async set(key: string, value: T, ttlMs: number): Promise<void> {
    this.values.delete(key);
    if (this.values.size >= this.capacity)
      this.values.delete(this.values.keys().next().value!);
    this.values.set(key, {
      value: structuredClone(value),
      expires: this.now() + ttlMs,
    });
  }
}
