import type { BatchRecord, BatchFormData } from '@/types/batch';

const STORAGE_KEY = 'hydroloop_batches';

function load(): BatchRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function save(batches: BatchRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
}

export function getBatches(): BatchRecord[] {
  return load().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function getBatch(id: string): BatchRecord | undefined {
  return load().find((b) => b.id === id);
}

export function saveBatch(data: BatchFormData): BatchRecord {
  const batches = load();
  const now = new Date().toISOString();
  const record: BatchRecord = {
    id: data.BATCH_ID,
    data,
    createdAt: now,
    updatedAt: now,
  };
  batches.push(record);
  save(batches);
  return record;
}

export function updateReport(id: string, report: string) {
  const batches = load();
  const idx = batches.findIndex((b) => b.id === id);
  if (idx !== -1) {
    batches[idx].report = report;
    batches[idx].updatedAt = new Date().toISOString();
    save(batches);
  }
}

export function deleteBatch(id: string) {
  const batches = load().filter((b) => b.id !== id);
  save(batches);
}

export function generateBatchId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const existing = load().filter((b) => b.id.startsWith(`B${datePart}`));
  const seq = String(existing.length + 1).padStart(2, '0');
  return `B${datePart}-${seq}`;
}
