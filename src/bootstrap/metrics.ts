import { InternalHeaders } from "./headers.ts";

interface FetchCall {
  host?: string;
  start: number;
  end?: number;
}

export class RequestMetrics {
  private fetchCalls: FetchCall[];
  private invokedFunctions: string[];
  private passthroughCalls: number[];

  constructor(initialMetrics?: RequestMetrics) {
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
  }
}
