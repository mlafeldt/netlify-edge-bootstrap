export enum ErrorType {
  Unknown = "error_unknown",
  User = "error_user",
}

// Signals a user error.
export class UnhandledFunctionError extends Error {}

// Signals an error in an operation that should not be retried.
export class UnretriableError extends Error {}
