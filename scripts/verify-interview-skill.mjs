#!/usr/bin/env node
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// 校验这个包使用的单行 frontmatter 和行内 Markdown 链接，不充当通用 YAML/Markdown 解析器。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillDirectory = resolve(root, "skills/interview-prep");
const skillPath = resolve(skillDirectory, "SKILL.md");
const acceptancePath = resolve(root, "test/skills/interview-prep.md");
const decoder = new TextDecoder("utf-8", { fatal: true });
const documents = new Map();

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function inside(parent, child) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

async function document(path) {
  if (documents.has(path)) return documents.get(path);
  requireThat(
    (await stat(path)).isFile(),
    `${relative(root, path)} 必须是文件`,
  );
  const text = decoder.decode(await readFile(path)).replace(/\r\n/g, "\n");
  requireThat(text.trim().length > 0, `${relative(root, path)} 不能为空`);
  requireThat(text.endsWith("\n"), `${relative(root, path)} 缺少末尾换行`);
  documents.set(path, text);
  return text;
}

function prose(text, label) {
  let fence;
  const lines = text.split("\n").map((line, index) => {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (match && !fence) {
      fence = { marker: match[1][0], size: match[1].length, line: index + 1 };
    } else if (
      match &&
      match[1][0] === fence?.marker &&
      match[1].length >= fence.size &&
      !match[2].trim()
    ) {
      fence = undefined;
      return "";
    } else if (!fence) {
      return line.replace(/(`+).*?\1/g, "");
    }
    return "";
  });
  requireThat(!fence, `${label}:${fence?.line} 代码围栏未闭合`);
  return lines.join("\n");
}

function anchors(text, label) {
  const seen = new Map();
  const result = new Set();
  for (const match of prose(text, label).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    result.add(count ? `${slug}-${count}` : slug);
  }
  return result;
}

async function checkLinks(path, text) {
  const label = relative(root, path);
  const body = prose(text, label);
  // 当前两份文档只用简单行内链接；拒绝未支持的引用形式，避免静默漏检。
  requireThat(
    !/^\s*\[[^\]]+\]:/m.test(body) && !/\]\[[^\]]*\]/.test(body),
    `${label} 请使用行内链接`,
  );
  requireThat(
    !/<(?:a|img)\b/i.test(body),
    `${label} 不支持 HTML 引用，请使用行内链接`,
  );
  const links = [...body.matchAll(/\[[^\]\n]+\]\(([^\s()]+)\)/g)];
  requireThat(
    links.length === [...body.matchAll(/\]\(/g)].length,
    `${label} 链接格式不受支持或未闭合`,
  );
  let local = 0;
  for (const [, target] of links) {
    requireThat(
      !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target),
      `${label} 引用须在仓库内：${target}`,
    );
    const hash = target.indexOf("#");
    const file = decodeURIComponent(hash < 0 ? target : target.slice(0, hash));
    const fragment =
      hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1));
    const destination = file ? resolve(dirname(path), file) : path;
    const boundary = path === skillPath ? skillDirectory : root;
    requireThat(
      inside(boundary, destination),
      `${label} 引用越过包边界：${target}`,
    );
    const actual = await realpath(destination);
    requireThat(
      inside(await realpath(boundary), actual),
      `${label} 引用指向包外：${target}`,
    );
    requireThat(
      (await stat(actual)).isFile(),
      `${label} 引用不是文件：${target}`,
    );
    if (fragment !== undefined) {
      requireThat(
        destination.endsWith(".md"),
        `${label} 仅 Markdown 引用可使用标题锚点：${target}`,
      );
      requireThat(
        anchors(await document(destination), target).has(fragment),
        `${label} 标题锚点不存在：${target}`,
      );
    }
    local += 1;
  }
  return local;
}

try {
  const entries = await readdir(skillDirectory, { withFileTypes: true });
  requireThat(
    entries.length === 1 &&
      entries[0].name === "SKILL.md" &&
      entries[0].isFile(),
    "skill 包应仅含普通文件 SKILL.md，不含个人档案、链接或额外依赖",
  );
  const skill = await document(skillPath);
  const acceptance = await document(acceptancePath);
  const lineCount = skill.split("\n").length - 1;
  requireThat(lineCount <= 500, `SKILL.md 共 ${lineCount} 行，超过 500 行`);
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  requireThat(frontmatter, "SKILL.md 缺少完整的 YAML frontmatter");
  const fields = new Map();
  for (const line of frontmatter[1].split("\n")) {
    const match = line.match(/^([a-z-]+): (\S.*)$/);
    requireThat(match, `frontmatter 须使用单行 key: value：${line}`);
    requireThat(!fields.has(match[1]), `frontmatter 字段重复：${match[1]}`);
    fields.set(match[1], match[2]);
  }
  requireThat(
    fields.size === 3 &&
      ["name", "description", "disable-model-invocation"].every((key) =>
        fields.has(key),
      ),
    "frontmatter 须包含且仅包含 name、description、disable-model-invocation",
  );
  requireThat(
    fields.get("name") === "interview-prep",
    "frontmatter name 须与目录名 interview-prep 一致",
  );
  requireThat(
    fields.get("disable-model-invocation") === "true",
    "disable-model-invocation 须为布尔值 true",
  );
  const description = fields.get("description");
  requireThat(
    description.length <= 1024 &&
      !/^[[\]{},&*!|>'"%@`#?\-:]|:(?:\s|$)|\s#|[\r\t]/.test(description) &&
      !/^(?:true|false|null|~|[\d.+-]+)$/i.test(description),
    "description 须为非空、至多 1024 字符的单行 YAML 普通字符串",
  );
  requireThat(
    /^#\s+\S/m.test(skill.slice(frontmatter[0].length)),
    "SKILL.md 正文缺少一级标题",
  );
  const linkCount =
    (await checkLinks(skillPath, skill)) +
    (await checkLinks(acceptancePath, acceptance));
  console.log(`PASS: skill 包结构（1 个文件），SKILL.md ${lineCount}/500 行。`);
  console.log("PASS: frontmatter 名称、说明、手动调用设置及 UTF-8 文档格式。");
  console.log(
    `PASS: 2 份 Markdown 围栏、${linkCount} 个本地文件/标题引用可达。`,
  );
  console.log(
    "结构检查不评价模型行为；行为验收见 test/skills/interview-prep.md。",
  );
} catch (error) {
  console.error(`FAIL: interview-prep 结构检查：${error.message}`);
  process.exitCode = 1;
}
