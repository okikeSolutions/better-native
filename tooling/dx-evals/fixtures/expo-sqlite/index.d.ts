export interface SQLiteOpenOptions {
  readonly enableChangeListener?: boolean
}

export type SQLiteBindValue = string | number | null | boolean | Uint8Array | ArrayBuffer
export type SQLiteBindParams = Record<string, SQLiteBindValue> | SQLiteBindValue[]
export type SQLiteVariadicBindParams = SQLiteBindValue[]
export type Changeset = Uint8Array
export type DatabaseChangeEvent = {
  readonly databaseName: string
  readonly databaseFilePath: string
  readonly tableName: string
  readonly rowId: number
}
export type SQLiteExecuteAsyncResult<T> = AsyncIterableIterator<T> & {
  readonly lastInsertRowId: number
  readonly changes: number
  getAllAsync(): Promise<T[]>
}
export type SQLiteExecuteSyncResult<T> = IterableIterator<T>
export type SQLiteProviderAssetSource = {
  readonly assetId: number
  readonly forceOverwrite?: boolean
}
export type SQLiteProviderProps = { readonly databaseName: string }
export type SQLiteRunResult = { readonly lastInsertRowId: number; readonly changes: number }
export declare class SQLiteDatabase {}
export declare class SQLiteProvider {}
export declare class SQLiteSession {}
export declare class SQLiteStatement {}
export declare class SQLiteTaggedQuery {}
export declare const openDatabaseAsync: (
  name: string,
  options?: SQLiteOpenOptions,
  directory?: string,
) => Promise<any>
export declare const addDatabaseChangeListener: (
  listener: (event: DatabaseChangeEvent) => void,
) => { remove(): void }
