import { openDB, type IDBPDatabase } from 'idb';
import type { BatchRecord } from '@/types/batch';
import type { Variety } from '@/types/variety';
import type { ModuleRecord } from '@/types/module';

const DB_NAME = 'hydroloop-db';
const DB_VERSION = 2;
const STORE = 'batches';

type HydroLoopDB = {
  batches: {
    key: string;
    value: BatchRecord;
    indexes: { 'by-strain': string; 'by-date': string };
  };
  varieties: { key: string; value: Variety };
  modules: { key: string; value: ModuleRecord };
};

let _db: Promise<IDBPDatabase<HydroLoopDB>> | null = null;

function getDB(): Promise<IDBPDatabase<HydroLoopDB>> {
  if (!_db) {
    _db = openDB<HydroLoopDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('by-strain', 'data.SOUCHE' as never);
          store.createIndex('by-date', 'createdAt' as never);
        }
        // v2 : catalogue de variétés et modules physiques
        if (!db.objectStoreNames.contains('varieties')) db.createObjectStore('varieties', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('modules')) db.createObjectStore('modules', { keyPath: 'id' });
      },
    });
  }
  return _db;
}

export async function dbGetAll(): Promise<BatchRecord[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function dbGet(id: string): Promise<BatchRecord | undefined> {
  const db = await getDB();
  return db.get(STORE, id);
}

export async function dbPut(record: BatchRecord): Promise<void> {
  const db = await getDB();
  await db.put(STORE, record);
}

export async function dbDelete(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function dbGetByStrain(strain: string): Promise<BatchRecord[]> {
  const all = await dbGetAll();
  return all.filter((b) => b.data.SOUCHE === strain);
}

export async function dbGetAllVarieties(): Promise<Variety[]> {
  return (await getDB()).getAll('varieties');
}
export async function dbPutVariety(v: Variety): Promise<void> {
  await (await getDB()).put('varieties', v);
}
export async function dbDeleteVariety(id: string): Promise<void> {
  await (await getDB()).delete('varieties', id);
}
export async function dbGetAllModules(): Promise<ModuleRecord[]> {
  return (await getDB()).getAll('modules');
}
export async function dbPutModule(m: ModuleRecord): Promise<void> {
  await (await getDB()).put('modules', m);
}
export async function dbDeleteModule(id: string): Promise<void> {
  await (await getDB()).delete('modules', id);
}
