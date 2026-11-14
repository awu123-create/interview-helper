import { randomUUID } from "node:crypto";
import { WorkspaceDatabase, SCHEMA_VERSION } from "./database.js";
import { WriterLease } from "./writer.js";
import { TaskCountsRowSchema, WriterGenerationRowSchema, parseDatabaseRow, type WorkspaceStatus } from "../schemas.js";

export class WorkspaceStore {
  readonly database: WorkspaceDatabase;
  private lease?: WriterLease;

  constructor(dataDir: string, readOnly = false) {
    this.database = new WorkspaceDatabase(dataDir, readOnly);
    if (!readOnly) {
      this.lease = WriterLease.acquire(dataDir, this.database.db);
      this.recoverInterruptedTasks();
    }
  }

  write<T>(operation: () => T): T {
    const lease = this.lease;
    if (!lease) throw new Error("只读工作区不能写入");
    return this.database.db.transaction(() => {
      lease.assertCurrent(this.database.db);
      return operation();
    }).immediate();
  }

  private recoverInterruptedTasks() {
    this.write(() => {
      this.database.db.prepare(`
        UPDATE tasks
        SET status = 'failed', error_code = 'TASK_INTERRUPTED', error_message = '进程中断，任务未继续执行', updated_at = ?
        WHERE status = 'running'
      `).run(new Date().toISOString());
    });
  }

  createTask(kind: "model_prompt"): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.write(() => {
      this.database.db.prepare("INSERT INTO tasks (id, kind, status, created_at, updated_at) VALUES (?, ?, 'running', ?, ?)").run(id, kind, now, now);
    });
    return id;
  }

  finishTask(id: string, error?: { code: string; message: string }) {
    this.write(() => {
      this.database.db.prepare("UPDATE tasks SET status = ?, updated_at = ?, error_code = ?, error_message = ? WHERE id = ?").run(
        error ? "failed" : "completed",
        new Date().toISOString(),
        error?.code ?? null,
        error?.message ?? null,
        id,
      );
    });
  }

  getStatus(dataDir: string, provider = "", modelId = "", credentialConfigured = false): WorkspaceStatus {
    const writerRow = this.database.db.prepare("SELECT generation FROM writer_state WHERE singleton = 1").get();
    const writer = writerRow ? parseDatabaseRow(WriterGenerationRowSchema, writerRow) : undefined;
    const tasks = parseDatabaseRow(TaskCountsRowSchema, this.database.db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active FROM tasks").get());
    return {
      dataDir,
      schemaVersion: SCHEMA_VERSION,
      writerGeneration: writer?.generation ?? 0,
      activeTasks: tasks.active ?? 0,
      totalTasks: tasks.total,
      provider,
      modelId,
      credentialConfigured,
    };
  }

  close() {
    this.lease?.release();
    this.database.close();
  }
}
