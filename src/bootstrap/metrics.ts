import { InternalHeaders } from "./headers.ts";

interface FetchCall {
  host?: string;
  start: number;
  end?: number;
}

export enum Operations {
  CacheAPIRead = "cache-api-read",
  CacheAPIWrite = "cache-api-write",
}

export const LIMITS = {
  [Operations.CacheAPIRead]: 100,
  [Operations.CacheAPIWrite]: 20,
};

export class RequestMetrics {
  private counts: Map<string, number>;
  private limits: Record<string, number>;
  private fetchCalls: FetchCall[];
  private invokedFunctions: string[];
  private passthroughCalls: number[];

  private id: number;

  constructor(
    initialMetrics?: RequestMetrics,
    limits: Record<string, number> = LIMITS,
  ) {
    this.id = Math.random();
    this.counts = initialMetrics?.counts ?? new Map();
    this.limits = limits;
    this.fetchCalls = initialMetrics?.fetchCalls ?? [];
    this.invokedFunctions = initialMetrics?.invokedFunctions ?? [];
    this.passthroughCalls = initialMetrics?.passthroughCalls ?? [];
  }

  // Takes a high-resolution timestamp and rounds it to one decimal point.
  // It also transforms `25.0` into `25`.
  static formatDuration(rawDuration: number) {
    const duration = rawDuration.toFixed(1);

    return duration.endsWith(".0") ? duration.split(".")[0] : duration;
  }

  // Tracks a `fetch` call. By convention, a call without a host represents a
  // passthrough request.
  private trackFetchCall(host?: string) {
    const entry: FetchCall = {
      host,
      start: performance.now(),
    };
    const end = () => {
      entry.end = performance.now();
    };

    this.fetchCalls.push(entry);

    return { end };
  }

  // Registers a generic operation and returns the allowance for this type of
  // operation, including the one that is being registered. This means that
  // if the return value is lower than 0, the operation will be blocked.
  registerOperation(operation: Operations) {
    const count = this.counts.get(operation) || 0;
    const limit = this.limits[operation] || 0;

    this.counts.set(operation, count + 1);

    return limit - count;
  }

  registerInvokedFunction(name: string) {
    this.invokedFunctions.push(name);
  }

  startFetch(host: string) {
    return this.trackFetchCall(host);
  }

  startPassthrough() {
    return this.trackFetchCall();
  }

  writeHeaders(headers: Headers) {
    headers.set(
      InternalHeaders.EdgeFunctions,
      this.invokedFunctions.join(","),
    );

    for (const call of this.fetchCalls) {
      const id = call.host ? `host=${call.host}` : "passthrough";
      const duration = (call.end ?? performance.now()) - call.start;

      headers.append(
        InternalHeaders.FetchTiming,
        `${id};dur=${RequestMetrics.formatDuration(duration)}`,
      );
    }

    const cacheAPIOperations = [
      Operations.CacheAPIRead,
      Operations.CacheAPIWrite,
    ].map((key) => `${key};count=${this.counts.get(key) ?? 0}`);

    headers.set(
      InternalHeaders.InvocationMetrics,
      cacheAPIOperations.join(","),
    );
  }
}
