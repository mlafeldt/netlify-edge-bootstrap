// @ts-nocheck

import { E as EnvironmentOptions } from '../cache-7af07baa.d.ts';
export { B as Base64Encoder, N as NetlifyCache, O as Operation, R as RequestContextFactory } from '../cache-7af07baa.d.ts';

declare class NetlifyCacheStorage {
    #private;
    constructor(environmentOptions: EnvironmentOptions);
    open(name: string): Promise<Cache>;
    has(name: string): Promise<boolean>;
    delete(name: string): Promise<boolean>;
    keys(): Promise<string[]>;
    match(request: RequestInfo, options?: MultiCacheQueryOptions): Promise<Response | undefined>;
}

export { NetlifyCacheStorage };
