import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface MigrationReport {
  applied: string[];
  pending: string[];
}

const TABLE = '_cortes_migrations';
const NAME_PATTERN = /^\d{14}_[a-z0-9_]+$/;

export function listMigrations(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function migrate(file: string, folder: string): MigrationReport {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(
      `CREATE TABLE IF NOT EXISTS "${TABLE}" ("name" TEXT NOT NULL PRIMARY KEY, "applied_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    const done = new Set(
      db
        .prepare(`SELECT "name" FROM "${TABLE}"`)
        .all()
        .map((row) => (row as { name: string }).name),
    );
    const applied: string[] = [];
    for (const name of listMigrations(folder)) {
      if (done.has(name)) continue;
      const sql = fs.readFileSync(path.join(folder, name, 'migration.sql'), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare(`INSERT INTO "${TABLE}" ("name") VALUES (?)`).run(name);
      })();
      applied.push(name);
    }
    return { applied, pending: [] };
  } finally {
    db.close();
  }
}

export function status(file: string, folder: string): MigrationReport {
  const all = listMigrations(folder);
  if (!fs.existsSync(file)) return { applied: [], pending: all };
  const db = new Database(file, { readonly: true });
  try {
    const exists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(TABLE);
    const done = new Set(
      exists === undefined
        ? []
        : db
            .prepare(`SELECT "name" FROM "${TABLE}"`)
            .all()
            .map((row) => (row as { name: string }).name),
    );
    return {
      applied: all.filter((name) => done.has(name)),
      pending: all.filter((name) => !done.has(name)),
    };
  } finally {
    db.close();
  }
}
