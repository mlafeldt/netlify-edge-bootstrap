import { delay } from "https://deno.land/std@0.136.0/async/mod.ts";

const INITIAL_BACKOFF_DELAY = 5;
const MAX_BACKOFF_DELAY = 1000;
const MAX_RETRIES = 3;

// deno-lint-ignore no-explicit-any
type GenericFunction = (...args: any) => any;

interface RetryOptions {
  maxRetries?: number;
}

export async function backoffRetry<Type extends GenericFunction>(
  func: Type,
  { maxRetries = MAX_RETRIES }: RetryOptions = {},
): Promise<ReturnType<Type>> {
  let backoffDelay: number | undefined;
  let retry = 0;
  let finalError = new Error();

  while (retry < maxRetries) {
    try {
      return await func();
    } catch (error) {
      retry += 1;
      finalError = error;

      if (backoffDelay === undefined) {
        backoffDelay = INITIAL_BACKOFF_DELAY;
      } else {
        backoffDelay *= 2;
      }

      if (backoffDelay > MAX_BACKOFF_DELAY) {
        backoffDelay = MAX_BACKOFF_DELAY;
      }

      await delay(backoffDelay);
    }
  }

  throw finalError;
}
