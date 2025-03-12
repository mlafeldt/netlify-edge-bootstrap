import { getNetlifyCacheStorage } from "../cache.ts";
import { patchDenoFS } from "../deno-fs.ts";
import { getEnvironment } from "../environment.ts";
import { patchLogger } from "../log/instrumented_log.ts";
import { patchFetchToTrackSubrequests } from "../util/fetch.ts";
import { patchResponseRedirect } from "../util/redirect.ts";
import { patchFetchToForwardHeaders } from "./fetch.ts";

const LABEL_SEPARATOR = " ";

export const patchTimeLogging = (
  time: typeof console.time,
  timeLog: typeof console.timeLog,
  timeEnd: typeof console.timeEnd,
) => {
  // console.time/timeLog/timeEnd use the first argument as a label.
  // we prefix it with the Netlify metadata, so that the labels are scoped to the request & function.
  // this only works if metadata is stable between two calls to `console.time`.
  // we can't fully guarantee this, but it's the best solution we have for now.
  const consoleTime = patchLogger(
    (...args) => time(args.join(LABEL_SEPARATOR)),
  );
  const consoleTimeLog = patchLogger(
    (nfMeta, label, ...args) =>
      timeLog([nfMeta, label].join(LABEL_SEPARATOR), ...args),
  );
  const consoleTimeEnd = patchLogger(
    (...args) => timeEnd(args.join(LABEL_SEPARATOR)),
  );

  return {
    time: consoleTime,
    timeLog: consoleTimeLog,
    timeEnd: consoleTimeEnd,
  };
};

export const patchGlobals = () => {
  // https://developer.mozilla.org/en-US/docs/Web/API/console#instance_methods
  globalThis.console.log = patchLogger(globalThis.console.log);
  globalThis.console.error = patchLogger(globalThis.console.error);
  globalThis.console.debug = patchLogger(globalThis.console.debug);
  globalThis.console.warn = patchLogger(globalThis.console.warn);
  globalThis.console.info = patchLogger(globalThis.console.info);
  globalThis.console.trace = patchLogger(globalThis.console.trace);

  const { time, timeLog, timeEnd } = patchTimeLogging(
    globalThis.console.time,
    globalThis.console.timeLog,
    globalThis.console.timeEnd,
  );

  globalThis.console.time = time;
  globalThis.console.timeLog = timeLog;
  globalThis.console.timeEnd = timeEnd;

  // https://deno.com/deploy/docs/runtime-fs
  globalThis.Deno.cwd = patchDenoFS(globalThis.Deno.cwd);
  globalThis.Deno.readDir = patchDenoFS(globalThis.Deno.readDir);
  globalThis.Deno.readFile = patchDenoFS(globalThis.Deno.readFile);
  globalThis.Deno.readTextFile = patchDenoFS(globalThis.Deno.readTextFile);
  globalThis.Deno.open = patchDenoFS(globalThis.Deno.open);
  globalThis.Deno.stat = patchDenoFS(globalThis.Deno.stat);
  globalThis.Deno.lstat = patchDenoFS(globalThis.Deno.lstat);
  globalThis.Deno.realPath = patchDenoFS(globalThis.Deno.realPath);
  globalThis.Deno.readLink = patchDenoFS(globalThis.Deno.readLink);

  Response.redirect = patchResponseRedirect(Response.redirect);

  globalThis.fetch = patchFetchToForwardHeaders(globalThis.fetch);
  globalThis.fetch = patchFetchToTrackSubrequests(globalThis.fetch);
};

let hasPatchedCaches = false;

export const patchCaches = () => {
  if (hasPatchedCaches || getEnvironment() !== "production") {
    return;
  }

  hasPatchedCaches = true;

  globalThis.caches = getNetlifyCacheStorage();
};
