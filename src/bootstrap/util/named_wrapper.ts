// deno-lint-ignore no-explicit-any
type GenericFunction = (...args: any) => any;

// Runs the callback supplied wrapped with an identity function with a given
// name. The only difference from running the callback directly is that the
// stack trace will have an entry with the wrapper function, which can be
// used for injecting arbitrary information into a function call.
export function callWithNamedWrapper<Type extends GenericFunction>(
  callback: Type,
  name: string,
) {
  const wrapper = (f: (...args: unknown[]) => ReturnType<Type>) => f();

  Object.defineProperty(wrapper, "name", {
    value: name,
    writable: false,
  });

  return wrapper(() => callback());
}
