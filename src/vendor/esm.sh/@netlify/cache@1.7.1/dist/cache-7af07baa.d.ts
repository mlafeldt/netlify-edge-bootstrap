// @ts-nocheck

type Base64Encoder = (input: string) => string;
type Logger = (...args: any[]) => void;
interface EnvironmentOptions {
    base64Encode: Base64Encoder;
    getContext: RequestContextFactory;
    userAgent?: string;
}
declare enum Operation {
    Delete = "delete",
    Read = "read",
    Write = "write"
}
type RequestContextFactory = (options: {
    operation: Operation;
}) => RequestContext | null;
interface RequestContext {
    host: string;
    logger?: Logger;
    token: string;
    url: string;
}

type NetlifyCacheOptions = EnvironmentOptions & {
    name: string;
};
declare const getInternalHeaders: unique symbol;
declare const serializeResourceHeaders: unique symbol;
declare class NetlifyCache implements Cache {
    #private;
    constructor({ base64Encode, getContext, name, userAgent }: NetlifyCacheOptions);
    private [getInternalHeaders];
    private [serializeResourceHeaders];
    add(request: RequestInfo): Promise<void>;
    addAll(requests: RequestInfo[]): Promise<void>;
    delete(request: RequestInfo): Promise<boolean>;
    keys(_request?: Request): Promise<never[]>;
    match(request: RequestInfo): Promise<Response | undefined>;
    matchAll(request?: RequestInfo, _options?: CacheQueryOptions): Promise<readonly Response[]>;
    put(request: RequestInfo | URL | string, response: Response): Promise<void>;
}

export { Base64Encoder as B, EnvironmentOptions as E, NetlifyCache as N, Operation as O, RequestContextFactory as R };
