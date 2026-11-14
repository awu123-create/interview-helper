import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { WorkspaceStatusSchema, WorkspaceToolInputSchema, type WorkspaceStatus } from "../schemas.js";

export function createWorkspaceStatusTool(readStatus: () => WorkspaceStatus): ToolDefinition {
  return {
    name: "workspace_status",
    label: "工作区状态",
    description: "读取当前 Interview Helper 工作区、写入代次和任务状态，不修改任何数据。",
    promptSnippet: "workspace_status: 读取当前工作区状态",
    parameters: WorkspaceToolInputSchema,
    outputSchema: WorkspaceStatusSchema,
    execute: async () => {
      const status = Value.Parse(WorkspaceStatusSchema, readStatus());
      return {
        content: [{ type: "text", text: JSON.stringify(status) }],
        structuredContent: status,
        details: status,
      };
    },
  };
}
