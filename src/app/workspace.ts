import { loadModelConfig } from "../config/load-model-config.js";
import { AppError, asAppError } from "../errors.js";
import { hasCredentials } from "../runtime/credentials.js";
import {
  PiModelRunner,
  type ModelEvent,
  type ModelRunner,
  type ModelRunnerDependencies,
} from "../runtime/pi.js";
import type { ModelConfig, WorkspaceStatus } from "../schemas.js";
import { WorkspaceStore } from "../store/workspace-store.js";

export interface WorkspaceSnapshot {
  status: WorkspaceStatus;
  activeTools: string[];
}

export interface Workbench {
  readonly config: ModelConfig | undefined;
  getSnapshot(): WorkspaceSnapshot;
  prompt(text: string, onEvent: (event: ModelEvent) => void): Promise<void>;
  close(): Promise<void>;
}

export type ModelRunnerFactory = (
  dependencies: ModelRunnerDependencies,
) => ModelRunner;

class Workspace implements Workbench {
  readonly config: ModelConfig | undefined;
  private runner: ModelRunner | undefined;
  private running = false;

  constructor(
    private readonly dataDir: string,
    private readonly store: WorkspaceStore,
    config: ModelConfig | undefined,
    private readonly env: NodeJS.ProcessEnv,
    private readonly runnerFactory: ModelRunnerFactory,
  ) {
    this.config = config;
  }

  getSnapshot(): WorkspaceSnapshot {
    return {
      status: this.readStatus(),
      activeTools: this.runner?.activeTools() ?? ["workspace_status"],
    };
  }

  async prompt(
    text: string,
    onEvent: (event: ModelEvent) => void,
  ): Promise<void> {
    if (this.running)
      throw new AppError("REQUEST_IN_PROGRESS", "上一个模型任务仍在运行");
    const taskId = this.store.createTask("model_prompt");
    this.running = true;
    try {
      await this.getRunner().prompt(text, onEvent);
      this.store.finishTask(taskId);
    } catch (error) {
      const appError = asAppError(error, taskId);
      this.store.finishTask(taskId, appError);
      throw appError;
    } finally {
      this.running = false;
    }
  }

  async close(): Promise<void> {
    await this.runner?.dispose();
    this.store.close();
  }

  private readStatus(): WorkspaceStatus {
    return this.store.getStatus(
      this.dataDir,
      this.config?.provider,
      this.config?.modelId,
      hasCredentials(this.config, this.env),
    );
  }

  private getRunner(): ModelRunner {
    this.runner ??= this.runnerFactory({
      dataDir: this.dataDir,
      config: this.config,
      env: this.env,
      readStatus: () => this.readStatus(),
    });
    return this.runner;
  }
}

export function openWorkspace(
  dataDir: string,
  overrides: Partial<ModelConfig> = {},
  options: {
    readOnly?: boolean;
    env?: NodeJS.ProcessEnv;
    runnerFactory?: ModelRunnerFactory;
  } = {},
): Workbench {
  const store = new WorkspaceStore(dataDir, options.readOnly ?? false);
  const config = loadModelConfig(dataDir, overrides);
  return new Workspace(
    dataDir,
    store,
    config,
    options.env ?? process.env,
    options.runnerFactory ??
      ((dependencies) => new PiModelRunner(dependencies)),
  );
}
