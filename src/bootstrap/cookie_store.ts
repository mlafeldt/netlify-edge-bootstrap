import {
  deleteCookie,
  getCookies,
  setCookie,
} from "https://deno.land/std@0.170.0/http/cookie.ts";

import { Cookie, Cookies, DeleteCookieOptions } from "./cookie.ts";

interface DeleteCookieOp {
  options: DeleteCookieOptions;
  type: "delete";
}

interface SetCookieOp {
  cookie: Cookie;
  type: "set";
}

class CookieStore {
  ops: (DeleteCookieOp | SetCookieOp)[];
  request: Request;

  constructor(request: Request) {
    this.ops = [];
    this.request = request;
  }

  apply(headers: Headers) {
    this.ops.forEach((op) => {
      switch (op.type) {
        case "delete":
          deleteCookie(headers, op.options.name, {
            domain: op.options.domain,
            path: op.options.path,
          });

          break;

        case "set":
          setCookie(headers, op.cookie);

          break;
      }
    });

    return headers;
  }

  delete(input: string | DeleteCookieOptions) {
    const defaultOptions = {
      path: "/",
    };
    const options = typeof input === "string" ? { name: input } : input;

    this.ops.push({
      options: { ...defaultOptions, ...options },
      type: "delete",
    });
  }

  get(name: string) {
    return getCookies(this.request.headers)[name];
  }

  getPublicInterface(): Cookies {
    return {
      delete: this.delete.bind(this),
      get: this.get.bind(this),
      set: this.set.bind(this),
    };
  }

  set(cookie: Cookie) {
    this.validate(cookie);
    this.ops.push({ cookie, type: "set" });
  }

  private validate(cookie: Cookie) {
    setCookie(new Headers(), cookie); // throws if invalid
  }
}

export { CookieStore };
