import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { AppError, asAppError } from "../errors.js";
import { parsePrompt, type ModelConfig, type WorkspaceStatus } from "../schemas.js";
import { resolveCredentials } from "./credentials.js";
import { createProductResourceLoader } from "./resources.js";
import { createWorkspaceStatusTool } from "./tools.js";

export type ModelEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool"; name: string; status: "started" | "completed" | "failed" }
  | { type: "retry"; attempt: number };

export interface ModelRunner {
  readonly activeTools: () => string[];
  prompt(text: string, onEvent: (event: ModelEvent) => void): Promise<void>;
  dispose(): Promise<void>;
}

export interface ModelRunnerDependencies {
  dataDir: string;
  config: ModelConfig | undefined;
  env: NodeJS.ProcessEnv;
  readStatus: () => WorkspaceStatus;
  sessionFactory?: () => Promise<AgentSession>;
}

export function createModelSettings(provider: string, modelId: string): SettingsManager {
  return SettingsManager.inMemory({
    defaultProvider: provider,
    defaultModel: modelId,
    defaultTools: ["workspace_status"],
    compaction: { enabled: false },
    cacheWarming: "off",
    retry: { enabled: true, maxRetries: 1, provider: { maxRetries: 0 } },
  });
}

export class PiModelRunner implements ModelRunner {
  private readonly dataDir: string;
  private readonly config: ModelConfig | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private readonly readStatus: () => WorkspaceStatus;
  private readonly sessionFactory: () => Promise<AgentSession>;
  private session?: AgentSession;
  private running = false;
  private disposing = false;
  private idlePromise: Promise<void> | undefined;

  constructor(dependencies: ModelRunnerDependencies) {
    this.dataDir = dependencies.dataDir;
    this.config = dependencies.config;
    this.env = dependencies.env;
    this.readStatus = dependencies.readStatus;
    this.sessionFactory = dependencies.sessionFactory ?? (() => this.createSession());
  }

  activeTools(): string[] {
    return this.session?.getActiveToolNames() ?? ["workspace_status"];
  }

  async prompt(text: string, onEvent: (event: ModelEvent) => void): Promise<void> {
    const input = parsePrompt(text);
    if (this.running) throw new AppError("REQUEST_IN_PROGRESS", "上一个模型任务仍在运行");
    this.running = true;
    let markIdle!: () => void;
    this.idlePromise = new Promise<void>((resolve) => { markIdle = resolve; });
    try {
      const session = await this.getSession();
      let modelFailure: AppError | undefined;
      let toolFailure: AppError | undefined;
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "auto_retry_start") modelFailure = undefined;
        const eventFailure = this.forwardEvent(event, onEvent);
        if (event.type === "tool_execution_end" && event.isError) toolFailure ??= eventFailure;
        else modelFailure ??= eventFailure;
      });
      try {
        await session.prompt(input);
      } finally {
        unsubscribe();
      }
      const failure = toolFailure ?? modelFailure;
      if (failure) throw failure;
    } catch (error) {
      throw asAppError(error);
    } finally {
      this.running = false;
      markIdle();
    }
  }

  private async getSession(): Promise<AgentSession> {
    if (this.session) return this.session;
    const session = await this.sessionFactory();
    if (this.disposing) {
      session.dispose();
      throw new AppError("MODEL_REQUEST_FAILED", "模型运行已停止");
    }
    this.session = session;
    return session;
  }

  private async createSession(): Promise<AgentSession> {
    const credentials = resolveCredentials(this.config, this.env);
    const runtimeDir = resolve(this.dataDir, "runtime");
    const modelRuntime = await ModelRuntime.create({
      authPath: resolve(runtimeDir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    await modelRuntime.setRuntimeApiKey(credentials.provider, credentials.apiKey);
    const model = modelRuntime.getModel(credentials.provider, credentials.modelId);
    if (!model) {
      throw new AppError("MODEL_NOT_FOUND", `内置模型不存在: ${credentials.provider}/${credentials.modelId}`);
    }
    const settingsManager = createModelSettings(credentials.provider, credentials.modelId);
    const result = await createAgentSession({
      cwd: runtimeDir,
      agentDir: runtimeDir,
      modelRuntime,
      model,
      scopedModels: [{ model }],
      thinkingLevel: "off",
      resourceLoader: createProductResourceLoader(),
      settingsManager,
      sessionManager: SessionManager.create(runtimeDir, resolve(runtimeDir, "sessions")),
      tools: ["workspace_status"],
      customTools: [createWorkspaceStatusTool(this.readStatus)],
    });
    return result.session;
  }

  private forwardEvent(event: AgentSessionEvent, onEvent: (event: ModelEvent) => void): AppError | undefined {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      onEvent({ type: "text_delta", delta: event.assistantMessageEvent.delta });
    } else if (event.type === "tool_execution_start") {
      onEvent({ type: "tool", name: event.toolName, status: "started" });
    } else if (event.type === "tool_execution_end") {
      const status = event.isError ? "failed" : "completed";
      onEvent({ type: "tool", name: event.toolName, status });
      if (event.isError) return new AppError("MODEL_REQUEST_FAILED", `工具 ${event.toolName} 调用失败`);
    } else if (event.type === "auto_retry_start") {
      onEvent({ type: "retry", attempt: event.attempt });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        return new AppError("MODEL_REQUEST_FAILED", event.message.errorMessage ?? `模型请求以 ${event.message.stopReason} 结束`);
      }
    } else if (event.type === "agent_settled" && event.aborted) {
      return new AppError("MODEL_REQUEST_FAILED", "模型请求已取消");
    }
    return undefined;
  }

  async dispose() {
    this.disposing = true;
    if (this.running) {
      const active = this.idlePromise;
      await this.session?.abort();
      await active;
    }
    this.session?.dispose();
  }
}
