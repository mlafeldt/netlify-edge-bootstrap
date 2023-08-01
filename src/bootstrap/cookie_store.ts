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

class CookieStore implements Cookies {
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

  delete(name: string): void;
  delete(options: DeleteCookieOptions): void;
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

  get(cookie: Pick<Cookie, "name">): string;
  get(name: string): string;
  get(input: Pick<Cookie, "name"> | string): string {
    const name = typeof input === "string" ? input : input.name;

    return getCookies(this.request.headers)[name];
  }

  getPublicInterface(): Cookies {
    return {
      delete: this.delete.bind(this),
      get: this.get.bind(this),
      set: this.set.bind(this),
    };
  }

  set(cookie: Cookie): void;
  set(name: string, value: string): void;
  set(input: Cookie | string, value?: string): void {
    let cookie: Cookie;

    if (typeof input === "string") {
      if (typeof value !== "string") {
        throw new Error(
          `You must provide the cookie value as a string to 'cookies.set'`,
        );
      }

      cookie = { name: input, value };
    } else {
      cookie = input;
    }

    this.validate(cookie);
    this.ops.push({ cookie, type: "set" });
  }

  private validate(cookie: Cookie) {
    setCookie(new Headers(), cookie); // throws if invalid
  }
}

export { CookieStore };
