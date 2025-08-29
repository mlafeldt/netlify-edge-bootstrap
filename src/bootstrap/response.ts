import { InternalHeaders, StandardHeaders } from "./headers.ts";
import { internalsSymbol } from "./request.ts";

// see https://github.com/netlify/stargate/blob/61c644240fbd601378cb093ee9e6334fdb542406/proxy/headers.go
const headersToPropagate = new Set<string>([
  InternalHeaders.ATSVersion,
  InternalHeaders.CacheResult,
  InternalHeaders.BBCache,
  InternalHeaders.BBSiteCancelled,
  InternalHeaders.BBProxyType,
  InternalHeaders.FunctionType,
  InternalHeaders.FunctionID,
  InternalHeaders.BlockReason,
  InternalHeaders.PassthroughTiming,
]);

class OriginResponse extends Response {
  [internalsSymbol] = {
    passthroughHeaders: new Headers(),
  };

  constructor(original: Response) {
    super(original.body, original);

    // The edge node sends headers we're using e.g. for metrics.
    // We move them to an internal field, so we can attach it to the final response later,
    // and hide it from the edge function.
    this.headers.forEach((value, key) => {
      if (headersToPropagate.has(key)) {
        this[internalsSymbol].passthroughHeaders.set(key, value);
        this.headers.delete(key);
      }
    });

    // Stripping the `Via` header from passthrough responses to prevent this
    // response from hitting the same edge node that served the passthrough,
    // causing ATS to detect a loop.
    this.headers.delete(StandardHeaders.Via);
  }
}

export { OriginResponse };
