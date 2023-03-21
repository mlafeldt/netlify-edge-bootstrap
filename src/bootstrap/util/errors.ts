export enum ErrorType {
  Unknown = "error_unknown",
  User = "error_user",
}

// Signals an error in user code.
export class UserError extends Error {}

// Signals an error in an operation that should not be retried.
export class UnretriableError extends Error {}
