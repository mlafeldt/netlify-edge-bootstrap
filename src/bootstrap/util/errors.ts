export enum ErrorType {
  Unknown = "error_unknown",
  User = "error_user",
}

// The number of `cause` levels we walk when flattening an error. Bounded so a
// circular chain can't hang us.
const MAX_CAUSE_DEPTH = 5;

// Returns an error's message joined with the messages of everything in its
// `cause` chain. Deno 2.9.3 collapsed `fetch` error messages down to
// "fetch failed" and moved the detail that identifies the failure into
// `cause`, so matching on the message alone misses it.
export const flattenErrorMessages = (error: unknown) => {
  const messages: string[] = [];
  let current = error;

  for (let depth = 0; current != null && depth <= MAX_CAUSE_DEPTH; depth++) {
    const { message } = current as Error;

    messages.push(typeof message === "string" ? message : String(current));
    current = (current as Error).cause;
  }

  return messages.join(": ");
};

// Signals an error in user code.
export class UserError extends Error {}

// Signals an error in an operation that should not be retried.
export class UnretriableError extends Error {
  constructor(parentError: Error) {
    super("An unretriable error has occurred", { cause: parentError });
  }
}

export class PassthroughError extends Error {
  constructor(error: Error) {
    const cause = error instanceof UnretriableError ? error.cause : error;

    super("There was an internal error while processing your request", {
      cause,
    });
  }
}

export class UnhandledRejectionError extends Error {
  constructor(error: Error) {
    const cause = error instanceof UnretriableError ? error.cause : error;

    super("Unhandled promise rejection", {
      cause,
    });
  }
}
