import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { AppError } from "../errors.js";
import { WriterGenerationRowSchema, WriterOwnerRowSchema, parseDatabaseRow, parseLockRecord, type LockRecord } from "../schemas.js";

export class WriterLease {
  private constructor(
    readonly lockPath: string,
    readonly writerId: string,
    readonly generation: number,
  ) {}

  static acquire(dataDir: string, db: Database.Database): WriterLease {
    const lockPath = resolve(dataDir, "runtime", "writer.lock");
    const writerId = randomUUID();
    return db.transaction(() => {
      const current = WriterLease.read(lockPath);
      if (current && WriterLease.isAlive(current.pid)) {
        throw new AppError("WORKSPACE_LOCKED", `工作区已由进程 ${current.pid} 写入`);
      }

      const generation = WriterLease.nextGeneration(db);
      rmSync(lockPath, { force: true });
      if (!WriterLease.createAtomically(lockPath, { writerId, generation, pid: process.pid })) {
        throw new AppError("WORKSPACE_LOCKED", "工作区锁在恢复期间被另一个进程取得");
      }
      try {
        WriterLease.writeOwner(db, writerId, generation);
        return new WriterLease(lockPath, writerId, generation);
      } catch (error) {
        WriterLease.removeOwned(lockPath, writerId);
        throw error;
      }
    }).immediate();
  }

  private static createAtomically(path: string, record: LockRecord): boolean {
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(record), { flag: "wx" });
    try {
      linkSync(temporary, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private static read(path: string): LockRecord | undefined {
    try {
      const text = readFileSync(path, "utf8");
      if (!text) return undefined;
      return parseLockRecord(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  private static removeOwned(path: string, writerId: string) {
    const record = WriterLease.read(path);
    if (record?.writerId === writerId) rmSync(path);
  }

  private static nextGeneration(db: Database.Database): number {
    const row = db.prepare("SELECT generation FROM writer_state WHERE singleton = 1").get();
    return (row ? parseDatabaseRow(WriterGenerationRowSchema, row).generation : 0) + 1;
  }

  private static writeOwner(db: Database.Database, writerId: string, generation: number) {
    db.prepare(`
      INSERT INTO writer_state (singleton, generation, owner_id, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET generation = excluded.generation, owner_id = excluded.owner_id, updated_at = excluded.updated_at
    `).run(generation, writerId, new Date().toISOString());
  }

  private static isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  }

  assertCurrent(db: Database.Database) {
    const row = parseDatabaseRow(WriterOwnerRowSchema, db.prepare("SELECT owner_id, generation FROM writer_state WHERE singleton = 1").get());
    if (row.owner_id !== this.writerId || row.generation !== this.generation) {
      throw new AppError("STALE_WRITER", "写入代次已变化，拒绝旧进程提交");
    }
  }

  release() {
    WriterLease.removeOwned(this.lockPath, this.writerId);
  }
}
