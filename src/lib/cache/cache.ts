export interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
}
