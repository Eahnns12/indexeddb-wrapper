type IDBSchema = {
  name: string;
  version?: number;
  objectStores?: {
    name: string;
    options: IDBObjectStoreParameters;
    indexes?: {
      name: string;
      keyPath: string | string[];
      options: IDBIndexParameters;
    }[];
  }[];
};

type IDBObjectStoreMethods =
  | "add"
  | "clear"
  | "count"
  | "delete"
  | "get"
  | "getAll"
  | "getAllKeys"
  | "getKey"
  | "put";

class IDB {
  static #idb: IDBFactory = window.indexedDB;

  static async list(): Promise<IDBDatabaseInfo[]> {
    try {
      if (!IDB.#idb.databases) {
        console.warn(
          "The 'databases' method is not supported in this browser.",
        );

        return [];
      }

      const databases = await IDB.#idb.databases();
      return databases;
    } catch (error) {
      throw error;
    }
  }

  static async has(name: string): Promise<boolean> {
    try {
      const databases = await IDB.list();
      const database = databases.find(database => database.name === name);
      const hasDatabase = Boolean(database);
      return hasDatabase;
    } catch (error) {
      throw error;
    }
  }

  static async delete(name: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<undefined>();
    const request = IDB.#idb.deleteDatabase(name);

    request.onsuccess = () => {
      resolve(undefined);
    };

    request.onerror = (event: Event) => {
      const target = event.target as IDBRequest;
      const error = target.error;
      reject(error);
    };

    return promise;
  }

  #db: IDBDatabase | undefined;
  #schema: IDBSchema | undefined;

  get db(): IDBDatabase {
    if (!this.#db) {
      throw new Error(
        "Database instance is not initialized. Make sure to call `open` before accessing the database.",
      );
    }

    return this.#db;
  }

  set db(value: IDBDatabase) {
    this.#db = value;
  }

  get schema(): IDBSchema {
    if (!this.#schema) {
      throw new Error(
        "Database instance is not initialized. Make sure to call `open` before accessing the database.",
      );
    }

    return this.#schema;
  }

  set schema(value: IDBSchema) {
    this.#schema = value;
  }

  constructor(schema: IDBSchema) {
    this.schema = schema;
  }

  async open(callback?: {
    onsuccess?: (event: Event) => Promise<void> | void;
    onerror?: (event: Event) => Promise<void> | void;
    onblocked?: (event: Event) => Promise<void> | void;
    onupgradeneeded?: (event: Event) => Promise<void> | void;
  }): Promise<IDB> {
    const { promise, resolve, reject } = Promise.withResolvers<IDB>();
    const { name, version, objectStores } = this.schema;
    const request: IDBOpenDBRequest = IDB.#idb.open(name, version);

    request.onsuccess = (event: Event): void => {
      const target = event.target as IDBRequest;
      const result = target.result as IDBDatabase;
      this.db = result;

      callback?.onsuccess?.(event);
      resolve(this);
    };

    request.onerror = (event: Event): void => {
      const target = event.target as IDBRequest;
      const error = target.error;
      callback?.onerror?.(event);
      reject(error);
    };

    request.onblocked = (event: IDBVersionChangeEvent): void => {
      callback?.onblocked?.(event);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
      const target = event.target as IDBRequest;
      const result = target.result as IDBDatabase;
      this.db = result;

      callback?.onupgradeneeded?.(event);

      if (!objectStores) {
        return;
      }

      for (const objectStore of objectStores) {
        if (this.db.objectStoreNames.contains(objectStore.name)) {
          continue;
        }

        const idbObjectStore = this.db.createObjectStore(
          objectStore.name,
          objectStore.options,
        );

        if (!objectStore.indexes) {
          continue;
        }

        for (const index of objectStore.indexes) {
          idbObjectStore.createIndex(index.name, index.keyPath, index.options);
        }
      }
    };

    return promise;
  }

  async transaction<T>(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions,
    callback?: (store: Record<string, IDBObjectStore>) => T | Promise<T>,
  ): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const transaction = this.db.transaction(storeNames, mode, options);
    const objectStoreNames = Array.from([storeNames].flat());
    const objectStore = objectStoreNames.reduce<Record<string, IDBObjectStore>>(
      (acc, curr) => ((acc[curr] = transaction.objectStore(curr)), acc),
      {},
    );

    let isCommittable = "commit" in transaction && mode !== "readonly";
    let result: T | undefined;

    transaction.oncomplete = (_: Event) => {
      resolve(result!);
    };

    transaction.onerror = (event: Event) => {
      const target = event.target as IDBTransaction;
      const error = target.error;
      reject(error);
    };

    try {
      result = await callback?.(objectStore);

      if (isCommittable) {
        transaction?.commit();
      }
    } catch (error) {
      transaction.abort();
      reject(error);
    }

    return promise;
  }

  async add<T>(
    storeName: string,
    value: T,
    key?: IDBValidKey,
  ): Promise<IDBValidKey> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "add", value, key),
    );
  }

  async clear(storeName: string): Promise<undefined> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "clear"),
    );
  }

  async count(storeName: string): Promise<number> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "count"),
    );
  }

  async delete(
    storeName: string,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<undefined> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "delete", query),
    );
  }

  async get<T>(
    storeName: string,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<T> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "get", query),
    );
  }

  async getAll<T>(
    storeName: string,
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<T[]> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "getAll", query, count),
    );
  }

  async getAllKeys(
    storeName: string,
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<IDBValidKey[]> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "getAllKeys", query, count),
    );
  }

  async getKey(
    storeName: string,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<IDBValidKey | undefined> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "getKey", query),
    );
  }

  async put<T>(
    storeName: string,
    value: T,
    key?: IDBValidKey,
  ): Promise<IDBValidKey> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "put", value, key),
    );
  }

  async #transactionCallback<T>(
    objectStore: IDBObjectStore,
    methodName: IDBObjectStoreMethods,
    ...args: any
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const request = (objectStore[methodName] as (...args: any[]) => IDBRequest)(
      ...args,
    );

    request.onsuccess = (event: Event) => {
      const target = event.target as IDBRequest;
      const result = target.result;
      resolve(result);
    };

    request.onerror = (event: Event) => {
      const target = event.target as IDBRequest;
      const error = target.error;
      reject(error);
    };

    return promise;
  }
}

export default IDB;
