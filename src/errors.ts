export type ErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_CONFIG"
  | "INTERNAL_ERROR"
  | "DATA_VERSION_UNSUPPORTED"
  | "WORKSPACE_LOCKED"
  | "STALE_WRITER"
  | "MODEL_NOT_CONFIGURED"
  | "MISSING_CREDENTIALS"
  | "MODEL_NOT_FOUND"
  | "MODEL_REQUEST_FAILED"
  | "REQUEST_IN_PROGRESS"
  | "TASK_INTERRUPTED";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly taskId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      taskId: this.taskId ?? null,
    };
  }
}

export function asCliError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : String(error),
    undefined,
    { cause: error },
  );
}

export function asAppError(error: unknown, taskId?: string): AppError {
  if (error instanceof AppError) {
    return new AppError(error.code, error.message, taskId ?? error.taskId, {
      cause: error.cause,
    });
  }
  return new AppError(
    "MODEL_REQUEST_FAILED",
    error instanceof Error ? error.message : String(error),
    taskId,
    { cause: error },
  );
}
