import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextData {
  correlationId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContextData>();

export class RequestContext {
  static getContext(): RequestContextData | undefined {
    return asyncLocalStorage.getStore();
  }

  static runWithContext<T>(store: RequestContextData, callback: () => T): T {
    return asyncLocalStorage.run(store, callback);
  }
}
