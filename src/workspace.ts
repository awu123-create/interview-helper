import { loadProductConfig, type CliOptions } from "./config.js";
import { hasCredentials } from "./runtime/credentials.js";
import type { ProductConfig, WorkspaceStatus } from "./schemas.js";
import { WorkspaceStore } from "./store/workspace-store.js";

export interface Workspace {
  store: WorkspaceStore;
  config?: ProductConfig;
  status: WorkspaceStatus;
  close(): void;
}

export function openWorkspace(
  dataDir: string,
  overrides: Pick<CliOptions, "provider" | "modelId"> = {},
  options: { readOnly?: boolean; env?: NodeJS.ProcessEnv } = {},
): Workspace {
  const store = new WorkspaceStore(dataDir, options.readOnly ?? false);
  const config = loadProductConfig(dataDir, overrides);
  const env = options.env ?? process.env;
  const status = store.getStatus(dataDir, config?.provider, config?.modelId, hasCredentials(config, env));
  return { store, ...(config ? { config } : {}), status, close: () => store.close() };
}
