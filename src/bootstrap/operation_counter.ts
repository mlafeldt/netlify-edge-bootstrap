export enum Operations {
  CacheAPIRead = "cache-api-read",
  CacheAPIWrite = "cache-api-write",
}

export const LIMITS = {
  [Operations.CacheAPIRead]: 100,
  [Operations.CacheAPIWrite]: 20,
};

export class OperationCounter {
  counts: Map<string, number>;
  limits: Record<string, number>;

  constructor(limits: Record<string, number> = LIMITS) {
    this.counts = new Map();
    this.limits = limits;
  }

  register(operation: string) {
    const count = this.counts.get(operation) || 0;
    const limit = this.limits[operation] || 0;

    if (count >= limit) {
      return false;
    }

    this.counts.set(operation, count + 1);

    return true;
  }
}
