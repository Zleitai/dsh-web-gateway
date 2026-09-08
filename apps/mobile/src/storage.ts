import type { Identity } from '@dsh-mobile/protocol';
export interface SavedHost { hostId: string; hostKey: string; relayUrl: string; identity: Identity; name: string }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dsh-pocket-devices', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('devices');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
export async function loadHost(): Promise<SavedHost | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('devices'); const request = tx.objectStore('devices').get('host');
    request.onsuccess = () => resolve(request.result as SavedHost | undefined); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function saveHost(value?: SavedHost): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('devices', 'readwrite');
    if (value) tx.objectStore('devices').put(value, 'host'); else tx.objectStore('devices').delete('host');
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
