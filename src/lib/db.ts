import { openDB, type IDBPDatabase } from 'idb';
import type { BatchRecord } from '@/types/batch';

const DB_NAME = 'hydroloop-db';
const DB_VERSION = 1;
const STORE = 'batches';

type HydroLoopDB = {
  batches: {
    key: string;
    value: BatchRecord;
    indexes: { 'by-strain': string; 'by-date': string };
  };
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
