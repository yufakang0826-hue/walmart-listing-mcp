#!/usr/bin/env node
// PostToolUse hook: when a critical source file in walmart-listing-mcp is
// edited, rebuild and run the structural smoke test. Reads tool-input JSON
// from stdin (per Claude Code hook contract).
//
// Why a Node script: jq is not always on PATH (Windows / Git Bash), and the
// project already requires Node ≥ 20.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const stdin = readFileSync(0, "utf8");
let event;
try {
  event = JSON.parse(stdin);
} catch {
  process.exit(0);
}

const filePath = event?.tool_input?.file_path || event?.tool_response?.filePath || "";
const normalized = filePath.replace(/\\/g, "/");

const TRIGGERS = [
  /walmart-listing-mcp\/src\/service\/walmart-tools\.ts$/,
  /walmart-listing-mcp\/src\/service\/walmart-client\.ts$/,
  /walmart-listing-mcp\/src\/helper\/format\.ts$/,
];

if (!TRIGGERS.some((re) => re.test(normalized))) {
  process.exit(0);
}

const repo = normalized.replace(/\/src\/.*$/, "");
process.stderr.write(`[hook] rebuilding + structural smoke after edit to ${path.basename(normalized)}\n`);

// shell: true is required on Windows to resolve npm.cmd. Args are hardcoded —
// no untrusted input flows through, so the Node 24 deprecation warning about
// shell-mode escaping is informational only. Suppress it via NODE_NO_WARNINGS.
const childEnv = { ...process.env, NODE_NO_WARNINGS: "1" };

const build = spawnSync("npm run build", { cwd: repo, encoding: "utf8", shell: true, env: childEnv });
if (build.status !== 0) {
  process.stderr.write(`[hook] build failed:\n${build.stderr || build.stdout || "(no output)"}\n`);
  process.exit(0);
}

const smoke = spawnSync("node scripts/smoke-test.mjs", { cwd: repo, encoding: "utf8", shell: true, env: childEnv });
const out = (smoke.stdout || "") + (smoke.stderr || "");
const summary = out.split("\n").filter((l) => /^(PASS|FAIL|\d+ passed)/.test(l)).join("\n");
process.stderr.write(summary + "\n");
