import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = join(root, "ARCHITECTURE.md");
const markdown = await readFile(input, "utf8");
const cliVersion = "12.2.0";

type Fence = {
  marker: string;
  length: number;
  line: number;
};

let fence: Fence | null = null;
let diagramCount = 0;
for (const [index, line] of markdown.split(/\r?\n/).entries()) {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) continue;
  const marker = match[1];
  const info = match[2];
  if (marker === undefined || info === undefined) continue;
  if (!fence) {
    fence = {
      marker: marker.charAt(0),
      length: marker.length,
      line: index + 1,
    };
    if (info.trim() === "mermaid") diagramCount += 1;
  } else if (
    match[1]?.charAt(0) === fence.marker &&
    marker.length >= fence.length &&
    info.trim() === ""
  ) {
    fence = null;
  }
}
if (fence) throw new Error("Unclosed Markdown fence at line " + fence.line);
if (diagramCount === 0)
  throw new Error("ARCHITECTURE.md contains no Mermaid diagrams.");

const browsers = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
let executablePath: string | undefined;
for (const candidate of browsers) {
  try {
    await access(candidate, constants.X_OK);
    executablePath = candidate;
    break;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EACCES") throw error;
  }
}
if (!executablePath) {
  throw new Error(
    "Document rendering requires Chrome, Edge, or Chromium installed in /Applications on macOS.",
  );
}

const outputDirectory = await mkdtemp(
  join(tmpdir(), "interview-helper-architecture-"),
);
const puppeteerConfig = join(outputDirectory, "puppeteer.json");
const mermaidConfig = join(outputDirectory, "mermaid.json");
await writeFile(puppeteerConfig, JSON.stringify({ executablePath }));
await writeFile(
  mermaidConfig,
  JSON.stringify({
    theme: "neutral",
    securityLevel: "strict",
    fontFamily: "PingFang SC, Arial, sans-serif",
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true, wrap: true },
  }),
);

console.log(
  "Checking " +
    diagramCount +
    " Mermaid diagrams with CLI " +
    cliVersion +
    "...",
);
const result = spawnSync(
  "npm",
  [
    "exec",
    "--yes",
    "--package=@mermaid-js/mermaid-cli@" + cliVersion,
    "--",
    "mmdc",
    "--input",
    input,
    "--output",
    join(outputDirectory, "ARCHITECTURE.md"),
    "--puppeteerConfigFile",
    puppeteerConfig,
    "--configFile",
    mermaidConfig,
    "--backgroundColor",
    "white",
    "--size",
    "1400",
    "--jobs",
    "1",
    "--no-font-embed",
  ],
  {
    cwd: root,
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "true" },
    stdio: "inherit",
    timeout: 300_000,
  },
);
if (result.error) throw result.error;
if (result.signal || result.status !== 0) {
  throw new Error(
    "Mermaid rendering failed: " + (result.signal ?? result.status),
  );
}
const diagrams = (await readdir(outputDirectory))
  .filter((name) => name.endsWith(".svg"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
if (diagrams.length !== diagramCount) {
  throw new Error(
    "Expected " + diagramCount + " rendered diagrams, found " + diagrams.length,
  );
}
for (const name of diagrams) {
  const svg = await readFile(join(outputDirectory, name), "utf8");
  if (!svg.includes("<svg") || !svg.includes("viewBox=")) {
    throw new Error("Invalid SVG output: " + name);
  }
}
const figures = diagrams
  .map(
    (name, index) =>
      "<figure><figcaption>Diagram " +
      (index + 1) +
      '</figcaption><img src="' +
      name +
      '" alt="Architecture diagram ' +
      (index + 1) +
      '"></figure>',
  )
  .join("\n");
await writeFile(
  join(outputDirectory, "index.html"),
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Architecture verification</title>' +
    "<style>body{max-width:1400px;margin:24px auto;padding:0 20px;font-family:system-ui;background:white}" +
    "figure{margin:0 0 48px}figcaption{font-weight:600;margin-bottom:12px}img{display:block;max-width:100%;height:auto}</style>" +
    "<h1>ARCHITECTURE.md — rendered diagrams</h1>" +
    figures +
    "</html>\n",
);
console.log(
  "PASS: Markdown fences and all " +
    diagramCount +
    " Mermaid diagrams rendered.",
);
console.log("Preview: " + join(outputDirectory, "index.html"));
