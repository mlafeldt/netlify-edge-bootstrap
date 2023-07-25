// deno-lint-ignore no-explicit-any
type AnyFunction = (...args: any[]) => any;

type PrepareStackTraceFunction = (error: Error, callSites: CallSite[]) => void;

declare global {
  interface ErrorConstructor {
    prepareStackTrace: PrepareStackTraceFunction;
    stackTraceLimit: number;
  }
}

// https://github.com/sindresorhus/callsites/blob/467c1de91e4e4d6f4c540c1ab99a7d47ee565471/index.d.ts
interface CallSite {
  /**
	Returns the value of `this`.
	*/
  getThis(): unknown | undefined;

  /**
	Returns the type of `this` as a string. This is the name of the function stored in the constructor field of `this`, if available, otherwise the object's `[[Class]]` internal property.
	*/
  getTypeName(): string | null;

  /**
	Returns the current function.
	*/
  getFunction(): AnyFunction | undefined;

  /**
	Returns the name of the current function, typically its `name` property. If a name property is not available an attempt will be made to try to infer a name from the function's context.
	*/
  getFunctionName(): string | null;

  /**
	Returns the name of the property of `this` or one of its prototypes that holds the current function.
	*/
  getMethodName(): string | undefined;

  /**
	Returns the name of the script if this function was defined in a script.
	*/
  getFileName(): string | null;

  /**
	Returns the current line number if this function was defined in a script.
	*/
  getLineNumber(): number | null;

  /**
	Returns the current column number if this function was defined in a script.
	*/
  getColumnNumber(): number | null;

  /**
	Returns a string representing the location where `eval` was called if this function was created using a call to `eval`.
	*/
  getEvalOrigin(): string | undefined;

  /**
	Returns `true` if this is a top-level invocation, that is, if it's a global object.
	*/
  isToplevel(): boolean;

  /**
	Returns `true` if this call takes place in code defined by a call to `eval`.
	*/
  isEval(): boolean;

  /**
	Returns `true` if this call is in native V8 code.
	*/
  isNative(): boolean;

  /**
	Returns `true` if this is a constructor call.
	*/
  isConstructor(): boolean;
}
