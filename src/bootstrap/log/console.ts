import { format } from "node:util";
import { getExecutionContextAndLogFailure } from "../util/execution_context.ts";
import { getEnvironment } from "../environment.ts";
import { LogLevel, NetlifyMetadata } from "./instrumented_log.ts";

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

const DenoStdoutWriteSync = Deno.stdout.writeSync.bind(Deno.stdout);
const DenoStderrWriteSync = Deno.stderr.writeSync.bind(Deno.stderr);

const encoder = new TextEncoder();
const formatArguments = (
  message?: any,
  optionalParams: any[] = [],
) => {
  if (message === undefined && optionalParams.length === 0) {
    return "";
  }

  return format(message, ...optionalParams);
};

function generateOutput(data: string, logLevel: LogLevel): Uint8Array {
  const preamble = generatePreamble();
  return encoder.encode(
    JSON.stringify({ msg: preamble + " " + data, level: logLevel }) + "\n",
  );
}

function writeAllToStdout(data: string, logLevel: LogLevel) {
  const output = generateOutput(data, logLevel);
  let written = 0;
  while (written < output.length) {
    written += DenoStdoutWriteSync(output.subarray(written));
  }
}

function writeAllToStderr(data: string, logLevel: LogLevel) {
  const output = generateOutput(data, logLevel);
  let written = 0;
  while (written < output.length) {
    written += DenoStderrWriteSync(output.subarray(written));
  }
}

function generatePreamble() {
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

    // If we have an associated function chain, add the request URL to the
    // metadata object.
    const chain = executionContext?.chain;
    if (chain) {
      const url = new URL(chain.request.url);

      // Deno log lines are cut off after 2048 characters. We don't want the
      // metadata to take up too much of that, so we truncate query parameters
      // if they're taking up too much space. They're ignored in Ingesteer.
      if (url.search.length > 256) {
        url.search = "?query-params-truncated";
      }

      metadata.url = url.toString();
    }

    return JSON.stringify({ __nfmeta: metadata });
  }

  if (edgeFunctionName) {
    return `[${edgeFunctionName}]`;
  }
}

const counts = new Map<string, number>();
let groupIndent = "";
const groupIndentationWidth = 2;
const times = new Map<string, number>();

export class NimbleConsole implements Console {
  declare trace: (message?: any, ...optionalParams: any[]) => void;

  get [Symbol.toStringTag]() {
    return "Console";
  }

  constructor() {
  }

  log(message?: any, ...optionalParams: any[]): void {
    writeAllToStdout(
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
      writeAllToStdout(preamble, "error");
      return;
    }

    const separator = message === undefined ? " " : ": ";
    writeAllToStdout(preamble + separator + formattedMessage, "error");
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
    writeAllToStdout(`${label}: ${count}`, "info");
  }

  countReset(label: string = "default"): void {
    if (!(counts.has(label))) {
      writeAllToStdout(`Count for '${label}' does not exist`, "warn");
      return;
    }
    counts.delete(label);
  }
  debug(message?: any, ...optionalParams: any[]) {
    writeAllToStdout(
      formatArguments(message, optionalParams),
      "debug",
    );
  }
  dir(
    obj?: any,
    { colors = false, depth = 2, showHidden = false }: InspectOptions = {},
  ): void {
    writeAllToStdout(Deno.inspect(obj, { colors, depth, showHidden }), "info");
  }
  dirxml(...data: any[]): void {
    writeAllToStdout(
      data.length === 0 ? "" : format(...data),
      "info",
    );
  }
  error(message?: any, ...optionalParams: any[]): void {
    writeAllToStderr(
      formatArguments(message, optionalParams),
      "error",
    );
  }
  group(...label: any[]): void {
    if (label.length > 0) {
      writeAllToStdout(format(...label), "info");
    }
    groupIndent += " ".repeat(groupIndentationWidth);
  }
  groupCollapsed(...label: any[]): void {
    if (label.length > 0) {
      writeAllToStdout(format(...label), "info");
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
    writeAllToStdout(
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

    writeAllToStdout(lines.join("\n"), "info");
  }
  time(label: string = "default"): void {
    label = label + "";
    if (times.has(label)) {
      writeAllToStdout(
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
      writeAllToStdout(
        `No such label '${label}' for console.timeEnd()`,
        "warn",
      );
      return;
    }
    const duration = performance.now() - time;
    times.delete(label);
    writeAllToStdout(`${label}: ${duration.toFixed(3)}ms`, "info");
  }
  timeLog(label: string = "default", ...data: any[]): void {
    label = label + "";
    const time = times.get(label);
    if (time === undefined) {
      writeAllToStdout(
        `No such label '${label}' for console.timeLog()`,
        "warn",
      );
      return;
    }
    const duration = performance.now() - time;
    writeAllToStdout(
      `${label}: ${duration.toFixed(3)}ms ` +
        format(...data),
      "info",
    );
  }
  warn(message?: any, ...optionalParams: any[]): void {
    writeAllToStderr(
      formatArguments(message, optionalParams),
      "warn",
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
}

NimbleConsole.prototype.trace = function trace(
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
    trace,
  );

  writeAllToStdout(err.stack + "", "info");
};
