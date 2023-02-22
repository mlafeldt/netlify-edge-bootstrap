export enum ErrorType {
  Unknown = "error_unknown",
  User = "error_user",
}

// Signals a user error.
export class UnhandledFunctionError extends Error {}
