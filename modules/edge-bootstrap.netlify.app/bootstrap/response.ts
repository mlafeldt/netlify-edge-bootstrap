class OriginResponse extends Response {
  ok: boolean;
  redirected: boolean;
  type: ResponseType;
  url: string;

  constructor(original: Response, additional: Response) {
    const headers = new Headers(original.headers);

    additional.headers.forEach((value, header) => {
      headers.set(header, value);
    });

    super(original.body, {
      ...original,
      headers,
      status: original.status,
      statusText: original.statusText,
    });

    this.ok = original.ok;
    this.redirected = original.redirected;
    this.type = original.type;
    this.url = original.url;
  }
}

export { OriginResponse };
