import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import Database from "better-sqlite3";

import { AppError } from "../errors.js";

export const SCHEMA_VERSION = 1;

export class WorkspaceDatabase {
  readonly db: Database.Database;

  constructor(
    readonly dataDir: string,
    readonly readOnly = false,
  ) {
    mkdirSync(resolve(dataDir, "runtime"), { recursive: true });
    this.db = new Database(resolve(dataDir, "state.sqlite"), {
      readonly: readOnly,
      fileMustExist: readOnly,
    });
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 100");
    if (readOnly) this.assertCompatible();
    else this.migrate();
  }

  private assertCompatible() {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version !== SCHEMA_VERSION) {
      throw new AppError(
        "DATA_VERSION_UNSUPPORTED",
        `数据版本 ${version} 与支持的版本 ${SCHEMA_VERSION} 不兼容`,
      );
    }
  }

  private migrate() {
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION) {
      throw new AppError(
        "DATA_VERSION_UNSUPPORTED",
        `数据版本 ${version} 高于支持的版本 ${SCHEMA_VERSION}`,
      );
    }
    if (version === SCHEMA_VERSION) return;
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS writer_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation INTEGER NOT NULL,
          owner_id TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          error_code TEXT,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
      `);
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  close() {
    this.db.close();
  }
}
