import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/errors.js";
import {
  TaskCountsRowSchema,
  WriterOwnerRowSchema,
  parseCliOptions,
  parseDatabaseRow,
  parseLockRecord,
} from "../src/schemas.js";

test("CLI 结果 schema 拒绝错误类型和多余字段", () => {
  for (const value of [
    { dataDir: "/tmp/data", status: "false", help: false },
    { dataDir: "/tmp/data", status: false, help: false, extra: true },
  ]) {
    assert.throws(
      () => parseCliOptions(value),
      (error: unknown) =>
        error instanceof AppError && error.code === "INVALID_ARGUMENT",
    );
  }
  assert.deepEqual(
    parseCliOptions({ dataDir: "/tmp/data", status: false, help: false }),
    {
      dataDir: "/tmp/data",
      status: false,
      help: false,
    },
  );
});

test("锁记录 schema 只接受完整的有效身份", () => {
  assert.deepEqual(
    parseLockRecord({ writerId: "writer-1", generation: 2, pid: 123 }),
    {
      writerId: "writer-1",
      generation: 2,
      pid: 123,
    },
  );
  for (const value of [
    { writerId: "writer-1", generation: 0, pid: 123 },
    { writerId: 42, generation: 2, pid: 123 },
    { writerId: "writer-1", generation: 2, pid: "123" },
  ]) {
    assert.equal(parseLockRecord(value), undefined);
  }
});

test("SQLite 行 schema 拒绝结构不匹配的数据", () => {
  assert.deepEqual(
    parseDatabaseRow(WriterOwnerRowSchema, {
      owner_id: "writer-1",
      generation: 1,
    }),
    {
      owner_id: "writer-1",
      generation: 1,
    },
  );
  for (const [schema, value] of [
    [WriterOwnerRowSchema, { owner_id: "writer-1", generation: "1" }],
    [TaskCountsRowSchema, { total: "1", active: 0 }],
    [TaskCountsRowSchema, { total: 1, active: -1 }],
  ] as const) {
    assert.throws(
      () => parseDatabaseRow(schema, value),
      (error: unknown) =>
        error instanceof AppError && error.code === "DATA_VERSION_UNSUPPORTED",
    );
  }
});
