import { writeFile } from "node:fs/promises";

import { NimbleConsole } from "./log/console.ts";

const SCALE_TO_ZERO_DISABLE_PATH = "/uk/libukp/scale_to_zero_disable";

/**
 * - Writing '+' increments the scale-to-zero disable counter
 * - Writing '-' decrements it
 * - Instance won't scale to zero while counter > 0
 */
function nimbleWaitUntil(promise: Promise<unknown>): void {
  if (arguments.length === 0) {
    throw new TypeError(
      "waitUntil: At least 1 argument required, but only 0 passed",
    );
  }

  setTimeout(() => {
    // Schedule the async work to run without blocking
    Promise.resolve()
      .then(() => {
        // Increment the scale-to-zero disable counter
        return writeFile(SCALE_TO_ZERO_DISABLE_PATH, "+", {
          encoding: "ascii",
        });
      })
      .then(() => promise)
      .finally(() => {
        // Decrement the scale-to-zero disable counter
        return writeFile(SCALE_TO_ZERO_DISABLE_PATH, "-", {
          encoding: "ascii",
        });
      })
      .catch((error) => console.error(error));
  }, 0);
}

function defaultWaitUntil(promise: Promise<unknown>): void {
  if (arguments.length === 0) {
    throw new TypeError(
      "waitUntil: At least 1 argument required, but only 0 passed",
    );
  }

  setTimeout(() => {
    // We call Promise.resolve on the supplied argument as to
    // ensure that it is now a Promise instance, which we can then add
    // a rejection handler onto via the `Promise.prototype.catch`
    // method.
    Promise.resolve(promise).catch((error) => console.error(error));
  }, 0);
}

function isNimble(): boolean {
  return globalThis.console instanceof NimbleConsole;
}

export const waitUntil = isNimble() ? nimbleWaitUntil : defaultWaitUntil;
