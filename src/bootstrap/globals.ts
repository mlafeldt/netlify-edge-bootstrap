declare global {
  // Using `var` so that the declaration is hoisted in such a way that we can
  // reference it before it's initialized.
  // deno-lint-ignore no-var
  var Netlify: {
    env: typeof env;
  };
}

export const env = {
  delete: Deno.env.delete,
  get: Deno.env.get,
  has: Deno.env.has,
  set: Deno.env.set,
  toObject: Deno.env.toObject,
};
