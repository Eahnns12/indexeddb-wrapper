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

type IDBRequestCallback = {
  onsuccess?: (event: Event) => any;
  onerror?: (event: Event) => any;
  onblocked?: (event: Event) => any;
  onupgradeneeded?: (event: Event) => any;
};

/**
 * Wrapper class for IndexedDB.
 */
class IDB {
  static #idb: IDBFactory = window.indexedDB;

  /**
   * Lists all databases.
   * @returns A promise that resolves to an array of database information.
   */
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

  /**
   * Checks if a database exists.
   * @param name - The name of the database.
   * @returns A promise that resolves to `true` if the database exists, otherwise `false`.
   */
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

  /**
   * Deletes a database by name.
   * @param name - The name of the database to delete.
   * @returns A promise that resolves when the database is deleted.
   */
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

  /**
   * Gets the database instance.
   * @returns The `IDBDatabase` instance.
   * @throws Throws an error if the database is not initialized.
   */
  get db(): IDBDatabase {
    if (!this.#db) {
      throw new Error(
        "Database instance is not initialized. Make sure to call `open` before accessing the database.",
      );
    }

    return this.#db;
  }

  /**
   * Sets the database instance.
   * @param value - The `IDBDatabase` instance.
   */
  set db(value: IDBDatabase) {
    this.#db = value;
  }

  /**
   * Gets the database schema.
   * @returns The `IDBSchema` structure.
   * @throws Throws an error if the database is not initialized.
   */
  get schema(): IDBSchema {
    if (!this.#schema) {
      throw new Error(
        "Database instance is not initialized. Make sure to call `open` before accessing the database.",
      );
    }

    return this.#schema;
  }

  /**
   * Sets the database schema.
   * @param value - The `IDBSchema` structure.
   */
  set schema(value: IDBSchema) {
    this.#schema = value;
  }

  /**
   * IDB class constructor.
   * @param schema - The database schema.
   */
  constructor(schema: IDBSchema) {
    this.schema = schema;
  }

  /**
   * Opens a connection to the database.
   * @param callback - An optional callback containing `onsuccess`, `onerror`, `onblocked`, and `onupgradeneeded` handlers.
   * @returns A promise that resolves to the `IDB` instance.
   */
  async open(callback?: IDBRequestCallback): Promise<IDB> {
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

      if (!objectStores) {
        return;
      }

      for (const objectStore of objectStores) {
        if (this.db.objectStoreNames.contains(objectStore.name)) {
          const transaction = target.transaction;

          if (!transaction) {
            continue;
          }

          const idbObjectStore = transaction.objectStore(objectStore.name);

          if (!objectStore.indexes) {
            continue;
          }

          for (const index of objectStore.indexes) {
            if (!idbObjectStore.indexNames.contains(index.name)) {
              idbObjectStore.createIndex(
                index.name,
                index.keyPath,
                index.options,
              );
            }
          }

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

      callback?.onupgradeneeded?.(event);
    };

    return promise;
  }

  /**
   * Closes the connection to the database.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Executes a transaction.
   * @param storeNames - The name or names of the object stores involved in the transaction.
   * @param mode - The mode of the transaction.
   * @param options - Optional transaction options.
   * @param callback - A callback function that receives the object stores and performs operations.
   * @returns A promise that resolves to the result of the callback.
   */
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

  /**
   * Adds data to a specified object store.
   * @param storeName - The name of the object store.
   * @param value - The data to add.
   * @param key - An optional key.
   * @returns A promise that resolves to the key of the added data.
   */
  async add<T>(
    storeName: string,
    value: T,
    key?: IDBValidKey,
  ): Promise<IDBValidKey> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "add", value, key),
    );
  }

  /**
   * Clears all data from a specified object store.
   * @param storeName - The name of the object store.
   * @returns A promise that resolves when the store is cleared.
   */
  async clear(storeName: string): Promise<undefined> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "clear"),
    );
  }

  /**
   * Counts the number of records in a specified object store.
   * @param storeName - The name of the object store.
   * @returns A promise that resolves to the count of records.
   */
  async count(storeName: string): Promise<number> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "count"),
    );
  }

  /**
   * Deletes records that match a query from a specified object store.
   * @param storeName - The name of the object store.
   * @param query - The key or key range to match for deletion.
   * @returns A promise that resolves when the records are deleted.
   */
  async delete(
    storeName: string,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<undefined> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "delete", query),
    );
  }

  /**
   * Retrieves a record that matches a query from a specified object store.
   * @param storeName - The name of the object store.
   * @param query - The key or key range to match.
   * @returns A promise that resolves to the retrieved record.
   */
  async get<T>(
    storeName: string,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<T> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "get", query),
    );
  }

  /**
   * Retrieves all records that match a query from a specified object store.
   * @param storeName - The name of the object store.
   * @param query - An optional key or key range to match.
   * @param count - An optional maximum number of records to retrieve.
   * @returns A promise that resolves to an array of matching records.
   */
  async getAll<T>(
    storeName: string,
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<T[]> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "getAll", query, count),
    );
  }

  /**
   * Retrieves all keys that match a query from a specified object store.
   * @param storeName - The name of the object store.
   * @param query - An optional key or key range to match.
   * @param count - An optional maximum number of keys to retrieve.
   * @returns A promise that resolves to an array of matching keys.
   */
  async getAllKeys(
    storeName: string,
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<IDBValidKey[]> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "getAllKeys", query, count),
    );
  }

  /**
   * Retrieves a single key that matches a query from a specified object store.
   * @param storeName - The name of the object store.
   * @param query - The key or key range to match.
   * @returns A promise that resolves to the matching key or `undefined`.
   */
  async getKey(
    storeName: string,
    query: IDBValidKey | IDBKeyRange,
  ): Promise<IDBValidKey | undefined> {
    return this.transaction(storeName, "readonly", {}, async store =>
      this.#transactionCallback(store[storeName], "getKey", query),
    );
  }

  /**
   * Updates or adds data to a specified object store.
   * @param storeName - The name of the object store.
   * @param value - The data to update or add.
   * @param key - An optional key.
   * @returns A promise that resolves to the key of the updated or added data.
   */
  async put<T>(
    storeName: string,
    value: T,
    key?: IDBValidKey,
  ): Promise<IDBValidKey> {
    return this.transaction(storeName, "readwrite", {}, async store =>
      this.#transactionCallback(store[storeName], "put", value, key),
    );
  }

  /**
   * Callback for transaction operations.
   * @param objectStore - The object store to operate on.
   * @param methodName - The name of the method to call on the object store.
   * @param args - Arguments to pass to the method.
   * @returns A promise that resolves to the result of the operation.
   */
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
