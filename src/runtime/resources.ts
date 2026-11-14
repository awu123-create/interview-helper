import { createExtensionRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent";

export const PRODUCT_SYSTEM_PROMPT = `你是 Interview Helper 的本地学习助手。
本轮只提供工作区状态查询和通用对话，不执行代码，不读取文件，不访问 Shell。
资料导入、知识整理和训练尚未接入，不得声称已经完成这些操作。
需要当前工作区事实时调用 workspace_status。回答使用中文，保持简洁。`;

export function createProductResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => PRODUCT_SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
