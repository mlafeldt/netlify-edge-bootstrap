import { format } from "node:util";
import { getExecutionContextAndLogFailure } from "../util/execution_context.ts";
import { getEnvironment } from "../environment.ts";
import {
  type LogLevel,
  type LogType,
  type NetlifyMetadata,
} from "./instrumented_log.ts";

const bind = Function.bind.call.bind(Function.bind) as <
  F extends (this: any, ...args: any[]) => any,
  T,
>(
  fn: F,
  thisArg: T,
) => (...args: Parameters<F>) => ReturnType<F>;

const encoder = new TextEncoder();
const encode = bind(encoder.encode, encoder);
const stringify = bind(JSON.stringify, JSON);

interface InspectOptions {
  /**
   * If `true`, object's non-enumerable symbols and properties are included in the formatted result.
   * `WeakMap` and `WeakSet` entries are also included as well as user defined prototype properties (excluding method properties).
   * @default false
   */
  showHidden?: boolean | undefined;
  /**
   * Specifies the number of times to recurse while formatting object.
   * This is useful for inspecting large objects.
   * To recurse up to the maximum call stack size pass `Infinity` or `null`.
   * @default 2
   */
  depth?: number | undefined;
  /**
   * If `true`, the output is styled with ANSI color codes. Colors are customizable.
   */
  colors?: boolean | undefined;
}

const formatArguments = (
  message?: any,
  optionalParams: any[] = [],
) => {
  if (message === undefined && optionalParams.length === 0) {
    return "";
  }

  return format(message, ...optionalParams);
};

/**
 * Detects if the log data is a system log by checking for the __nfmessage
 * marker that is added by instrumentedLog when serializing StructuredLogger.
 */
function detectSystemLog(data: string): LogType | undefined {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && "__nfmessage" in parsed) {
      return "systemJSON";
    }
  } catch {
    // Not JSON, not a system log
  }
  return undefined;
}

// The Nimble VMM (ukpd) reads each guest console line through a `socket/json`
// reader (see nimble-infra-ci `--vmm-console-ports`) that buffers at 16KB per
// line and truncates the rest. If our JSON envelope is cut mid-string the line
// becomes unparseable and Ingesteer drops it ("invalid nimble log body"). We
// keep every emitted line under that cap so it always stays valid JSON,
// truncating the user-supplied message when necessary.
const MAX_LOG_LINE_BYTES = 16 * 1024;
// Headroom below the hard cap for the trailing newline delimiter and the few
// bytes of boundary fuzz observed in ukpd's truncation.
const LOG_LINE_BYTE_BUDGET = MAX_LOG_LINE_BYTES - 256;
const TRUNCATION_MARKER = "...[truncated]";

const renderLine = (
  preamble: string | undefined,
  data: string,
  logLevel: LogLevel,
) => stringify({ msg: preamble + " " + data, level: logLevel });

// Binary-search the largest prefix of `data` whose rendered line (with a
// truncation marker appended) still fits within the byte budget. The preamble
// and metadata are always preserved. JSON.stringify escapes lone surrogates, so
// slicing mid-code-point still yields valid JSON.
function truncateData(
  preamble: string | undefined,
  data: string,
  logLevel: LogLevel,
): string {
  let lo = 0;
  let hi = data.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = data.slice(0, mid) + TRUNCATION_MARKER;
    if (
      encode(renderLine(preamble, candidate, logLevel)).length <=
        LOG_LINE_BYTE_BUDGET
    ) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return data.slice(0, lo) + TRUNCATION_MARKER;
}

// Does the rendered line for this (already-serialized) payload fit the budget?
const systemLogFits = (
  preamble: string | undefined,
  payload: Record<string, unknown>,
  logLevel: LogLevel,
) =>
  encode(renderLine(preamble, stringify(payload), logLevel)).length <=
    LOG_LINE_BYTE_BUDGET;

// A system log's `data` is itself a JSON object (`{"__nfmessage":...,...}`).
// Prefix-slicing it like a plain message would leave the object unterminated
// and unparseable downstream (Ingesteer rejects it, and consumers that re-parse
// the payload throw "unexpected end of input"). Instead we shrink the longest
// string-valued field(s) - typically a large `url` or `__nfmessage` - so the
// re-serialized payload stays valid JSON while fitting the byte budget. Returns
// `undefined` if the payload can't be parsed or can't be trimmed structurally,
// letting the caller fall back to plain string slicing.
function truncateSystemLog(
  preamble: string | undefined,
  data: string,
  logLevel: LogLevel,
): string | undefined {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  // Repeatedly trim the longest remaining string field until the line fits.
  while (!systemLogFits(preamble, payload, logLevel)) {
    let longestKey: string | undefined;
    let longestLength = TRUNCATION_MARKER.length;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string" && value.length > longestLength) {
        longestKey = key;
        longestLength = value.length;
      }
    }

    // Nothing left long enough to shave off; let the caller fall back.
    if (longestKey === undefined) {
      return undefined;
    }

    const original = payload[longestKey] as string;
    let lo = 0;
    let hi = original.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      payload[longestKey] = original.slice(0, mid) + TRUNCATION_MARKER;
      if (systemLogFits(preamble, payload, logLevel)) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    payload[longestKey] = original.slice(0, lo) + TRUNCATION_MARKER;
  }

  return stringify(payload);
}

function generateOutput(data: string, logLevel: LogLevel): Uint8Array {
  const type = detectSystemLog(data);
  const preamble = generatePreamble(type);
  const output = encode(renderLine(preamble, data, logLevel) + "\n");
  // The trailing newline is the console-line delimiter and isn't counted
  // toward ukpd's cap, so compare the line length without it.
  if (output.length - 1 <= LOG_LINE_BYTE_BUDGET) {
    return output;
  }
  // System logs must stay valid JSON, so truncate their fields structurally.
  // Fall back to plain string slicing for user messages, or if the payload
  // can't be trimmed that way.
  if (type === "systemJSON") {
    const fittedSystemLog = truncateSystemLog(preamble, data, logLevel);
    if (fittedSystemLog !== undefined) {
      return encode(renderLine(preamble, fittedSystemLog, logLevel) + "\n");
    }
  }
  const fitted = truncateData(preamble, data, logLevel);
  return encode(renderLine(preamble, fitted, logLevel) + "\n");
}

function generatePreamble(type?: LogType) {
  const executionContext = getExecutionContextAndLogFailure(
    "logger",
  );
  const edgeFunctionName = executionContext?.functionName;
  const environment = getEnvironment();

  if (environment === "production") {
    const metadata: NetlifyMetadata = {
      edgeFunctionName,
      requestID: executionContext?.requestID,
      spanID: executionContext?.spanID,
      logToken: executionContext?.logToken,
    };

    if (type) {
      metadata.type = type;
    }

    // If we have an associated function chain, add the request URL to the
    // metadata object.
    const chain = executionContext?.chain;
    if (chain) {
      const url = new URL(chain.request.url);

      // The console line has a fixed byte cap (see MAX_LOG_LINE_BYTES). We don't
      // want the metadata to eat into that, so we truncate query parameters if
      // they're taking up too much space. They're ignored in Ingesteer.
      if (url.search.length > 256) {
        url.search = "?query-params-truncated";
      }

      metadata.url = url.toString();
    }

    return stringify({ __nfmeta: metadata });
  }

  if (edgeFunctionName) {
    return `[${edgeFunctionName}]`;
  }
}

const counts = new Map<string, number>();
let groupIndent = "";
const groupIndentationWidth = 2;
const times = new Map<string, number>();

const getWriteStdoutSync = () => Deno.stdout.writeSync.bind(Deno.stdout);
const getWriteStderrSync = () => Deno.stderr.writeSync.bind(Deno.stderr);

export const resetConsoleState = () => {
  counts.clear();
  groupIndent = "";
  times.clear();
};

export class NimbleConsole implements Console {
  #writeAll(
    data: string,
    logLevel: LogLevel,
    writeSync: (data: Uint8Array) => number = getWriteStdoutSync(),
  ) {
    const output = generateOutput(data, logLevel);
    let written = 0;
    while (written < output.length) {
      written += writeSync(output.subarray(written));
    }
  }

  #bindMethods() {
    this.log = bind(this.log, this);
    this.assert = bind(this.assert, this);
    this.clear = bind(this.clear, this);
    this.count = bind(this.count, this);
    this.countReset = bind(this.countReset, this);
    this.debug = bind(this.debug, this);
    this.dir = bind(this.dir, this);
    this.dirxml = bind(this.dirxml, this);
    this.error = bind(this.error, this);
    this.group = bind(this.group, this);
    this.groupCollapsed = bind(this.groupCollapsed, this);
    this.groupEnd = bind(this.groupEnd, this);
    this.info = bind(this.info, this);
    this.table = bind(this.table, this);
    this.time = bind(this.time, this);
    this.timeEnd = bind(this.timeEnd, this);
    this.timeLog = bind(this.timeLog, this);
    this.warn = bind(this.warn, this);
    this.profile = bind(this.profile, this);
    this.profileEnd = bind(this.profileEnd, this);
    this.timeStamp = bind(this.timeStamp, this);
    this.trace = bind(this.trace, this);
  }

  get [Symbol.toStringTag]() {
    return "console";
  }

  constructor() {
    this.#bindMethods();
  }

  log(message?: any, ...optionalParams: any[]): void {
    this.#writeAll(
      formatArguments(message, optionalParams),
      "info",
    );
  }

  assert(
    value?: any,
    message?: string,
    ...optionalParams: any[]
  ): void {
    // If the assertion is true, we don't need to log anything and so we can return early.
    if (value) {
      return;
    }
    const preamble = "Assertion failed";
    const formattedMessage = formatArguments(message, optionalParams);

    if (formattedMessage === "") {
      this.#writeAll(preamble, "error");
      return;
    }

    const separator = message === undefined ? " " : ": ";
    this.#writeAll(preamble + separator + formattedMessage, "error");
  }

  // The `clear` method is a no-op for structured logging, as clearing the console
  // does not make sense in a log stream.
  clear(): void {
    // no-op
  }

  count(label: string = "default"): void {
    label = label + "";
    let count = counts.get(label);
    if (count === undefined) {
      count = 1;
    } else {
      count++;
    }
    counts.set(label, count);
    this.#writeAll(`${label}: ${count}`, "info");
  }

  countReset(label: string = "default"): void {
    if (!(counts.has(label))) {
      this.#writeAll(`Count for '${label}' does not exist`, "warn");
      return;
    }
    counts.delete(label);
  }
  debug(message?: any, ...optionalParams: any[]) {
    this.#writeAll(
      formatArguments(message, optionalParams),
      "debug",
    );
  }
  dir(
    obj?: any,
    { colors = false, depth = 2, showHidden = false }: InspectOptions = {},
  ): void {
    this.#writeAll(Deno.inspect(obj, { colors, depth, showHidden }), "info");
  }
  dirxml(...data: any[]): void {
    this.#writeAll(
      data.length === 0 ? "" : format(...data),
      "info",
    );
  }
  error(message?: any, ...optionalParams: any[]): void {
    this.#writeAll(
      formatArguments(message, optionalParams),
      "error",
      getWriteStderrSync(),
    );
  }
  group(...label: any[]): void {
    if (label.length > 0) {
      this.#writeAll(format(...label), "info");
    }
    groupIndent += " ".repeat(groupIndentationWidth);
  }
  groupCollapsed(...label: any[]): void {
    if (label.length > 0) {
      this.#writeAll(format(...label), "info");
    }
    groupIndent += " ".repeat(groupIndentationWidth);
  }
  groupEnd(): void {
    groupIndent = groupIndent.slice(
      0,
      -groupIndentationWidth,
    );
  }
  info(message?: any, ...optionalParams: any[]): void {
    this.#writeAll(
      formatArguments(message, optionalParams),
      "info",
    );
  }
  /**
   * @param data The data to display. This must be either an array or an object. Each item in the array, or property in the object, is represented by a row in the table. The first column in the table is labeled (index) and its values are the array indices or the property names.
   *              If the elements in the array, or properties in the object, are themselves arrays or objects, then their items or properties are enumerated in the row, one per column.
   * @param columns Optional An array which can be used to restrict the columns shown in the table. It contains indices, if each entry of data is an array, or property names, if each entry of data is an object. The resulting table then includes only columns for items which match the given indices or names.
   */
  table(data?: any, columns?: readonly string[]): void {
    if (data === null || typeof data !== "object") {
      this.log(data);
      return;
    }

    type Row = { index: string; values: Record<string, unknown> };
    const rows: Row[] = [];
    const registeredColumns = new Set<string>();
    const derivedColumns: string[] = [];

    const registerColumns = (keys: string[]) => {
      for (const key of keys) {
        const normalized = String(key);
        if (!registeredColumns.has(normalized)) {
          registeredColumns.add(normalized);
          derivedColumns.push(normalized);
        }
      }
    };

    const entries = Array.isArray(data)
      ? data.map((value, index) => [String(index), value] as const)
      : Object.entries(data).map(([key, value]) =>
        [String(key), value] as const
      );

    for (const [index, value] of entries) {
      let rowValues: Record<string, unknown> = {};
      let keys: string[] = [];

      if (value !== null && typeof value === "object") {
        if (Array.isArray(value)) {
          keys = value.map((_entry, idx) => String(idx));
          rowValues = keys.reduce((acc, key, idx) => {
            acc[key] = value[idx];
            return acc;
          }, {} as Record<string, unknown>);
        } else {
          keys = Object.keys(value);
          for (const key of keys) {
            rowValues[key] = (value as Record<string, unknown>)[key];
          }
        }
      } else {
        keys = ["Values"];
        rowValues.Values = value;
      }

      if (!columns || columns.length === 0) {
        registerColumns(keys);
      }

      rows.push({ index, values: rowValues });
    }

    const selectedColumns = rows.length === 0
      ? []
      : columns && columns.length > 0
      ? Array.from(new Set(columns.map((column) => String(column))))
      : derivedColumns;

    const headers = ["(index)", ...selectedColumns];
    const stringRows = rows.map((row) => {
      const cells: string[] = [row.index];
      for (const column of selectedColumns) {
        const hasValue = Object.prototype.hasOwnProperty.call(
          row.values,
          column,
        );
        cells.push(hasValue ? format("%O", row.values[column]) : "");
      }
      return cells;
    });

    const columnWidths = headers.map((header, headerIndex) => {
      const widest = stringRows.reduce(
        (length, row) => Math.max(length, row[headerIndex].length),
        header.length,
      );
      return widest;
    });

    const makeBorder = (left: string, join: string, right: string) =>
      left +
      columnWidths.map((width) => "─".repeat(width + 2)).join(join) +
      right;

    const makeRow = (cells: string[]) =>
      "│" +
      cells.map((cell, cellIndex) =>
        " " + cell.padEnd(columnWidths[cellIndex]) + " "
      ).join("│") +
      "│";

    const lines = [
      makeBorder("┌", "┬", "┐"),
      makeRow(headers),
      makeBorder("├", "┼", "┤"),
      ...stringRows.map(makeRow),
      makeBorder("└", "┴", "┘"),
    ];

    this.#writeAll(lines.join("\n"), "info");
  }
  time(label: string = "default"): void {
    label = label + "";
    if (times.has(label)) {
      this.#writeAll(
        `Label '${label}' already exists for console.time()`,
        "warn",
      );
      return;
    }
    times.set(label, performance.now());
  }
  timeEnd(label: string = "default"): void {
    label = label + "";
    const time = times.get(label);
    if (time === undefined) {
      this.#writeAll(
        `No such label '${label}' for console.timeEnd()`,
        "warn",
      );
      return;
    }
    const duration = performance.now() - time;
    times.delete(label);
    this.#writeAll(`${label}: ${duration.toFixed(3)}ms`, "info");
  }
  timeLog(label: string = "default", ...data: any[]): void {
    label = label + "";
    const time = times.get(label);
    if (time === undefined) {
      this.#writeAll(
        `No such label '${label}' for console.timeLog()`,
        "warn",
      );
      return;
    }
    const duration = performance.now() - time;
    this.#writeAll(
      `${label}: ${duration.toFixed(3)}ms ` +
        format(...data),
      "info",
    );
  }
  warn(message?: any, ...optionalParams: any[]): void {
    this.#writeAll(
      formatArguments(message, optionalParams),
      "warn",
      getWriteStderrSync(),
    );
  }
  profile(_label?: string): void {
    // no-op
  }
  profileEnd(_label?: string): void {
    // no-op
  }
  timeStamp(_label?: string): void {
    // no-op
  }

  trace(
    message?: any,
    ...optionalParams: any[]
  ): void {
    const err = new Error();
    err.name = "Trace";

    if (message !== undefined) {
      err.message = format(message, ...optionalParams);
    }

    Error.captureStackTrace(
      err,
      this.trace,
    );

    this.#writeAll(err.stack + "", "info");
  }
}
