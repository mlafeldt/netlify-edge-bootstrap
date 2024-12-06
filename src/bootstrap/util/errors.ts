export enum ErrorType {
  Unknown = "error_unknown",
  User = "error_user",
}

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
