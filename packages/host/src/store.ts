import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { identity, type Identity } from '@dsh-mobile/protocol';

export interface Device { id: string; publicKey: string; name: string; createdAt: number }
export interface Receipt { key: string; hash: string; state: 'pending' | 'done'; result: string | null }
/** Device credentials and request receipts stay on the host; no transcript is duplicated. */
export class HostStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,publicKey TEXT UNIQUE NOT NULL,name TEXT NOT NULL,createdAt INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS receipts(key TEXT PRIMARY KEY,hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT)');
    if (path !== ':memory:') chmodSync(path, 0o600);
  }
  get<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined; return row ? JSON.parse(row.value) as T : undefined; }
  set(key: string, value: unknown): void { this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key, JSON.stringify(value)); }
  identity(): Identity { let value = this.get<Identity>('identity'); if (!value) { value = identity(); this.set('identity', value); } return value; }
  devices(): Device[] { return this.db.prepare('SELECT * FROM devices ORDER BY createdAt').all() as unknown as Device[]; }
  addDevice(device: Device): void { this.db.prepare('INSERT INTO devices VALUES(?,?,?,?)').run(device.id, device.publicKey, device.name, device.createdAt); }
  revoke(id: string): void { this.db.prepare('DELETE FROM devices WHERE id=?').run(id); }
  receipt(key: string): Receipt | undefined { return this.db.prepare('SELECT * FROM receipts WHERE key=?').get(key) as unknown as Receipt | undefined; }
  begin(key: string, hash: string): void { this.db.prepare("INSERT INTO receipts VALUES(?,?,'pending',NULL)").run(key, hash); }
  finish(key: string, value: unknown): void { this.db.prepare("UPDATE receipts SET state='done',result=? WHERE key=?").run(JSON.stringify(value), key); }
  close(): void { this.db.close(); }
}
