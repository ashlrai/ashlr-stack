import { spawnSync } from "node:child_process";

export function firstTscDiagnostic(text) {
  const match = text.match(/^(.+?):(\d+):\d+ - error TS\d+: (.+)$/m);
  if (!match) return null;
  return { file: match[1], line: match[2], message: match[3] };
}

export function firstTestFailure(text, cwd = "") {
  const at = text.match(/\(([^()\n]+):(\d+):\d+\)/);
  const name = text.match(/^\(fail\) (.+?) \[/m);
  if (!at) return null;
  let file = at[1];
  if (cwd && file.startsWith(cwd)) file = file.slice(cwd.length).replace(/^[/\\]/, "");
  return { file: file.replaceAll("\\", "/"), line: at[2], message: name?.[1] ?? "test failed" };
}

function annotate(failure) {
  const message = failure.message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  console.error(`::error file=${failure.file},line=${failure.line}::${message}`);
}

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function failClosed(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function main() {
const base = process.env.BASE_SHA ?? "";
if (!base) failClosed("affected tests need a base revision");

const selected = run("bun", ["scripts/affected-tests.ts", base]);
if (selected.status !== 0) {
  const detail = `${selected.stdout ?? ""}${selected.stderr ?? ""}`.trim();
  failClosed(detail || "could not list affected tests");
}
const listed = selected.stdout.trim();
const typecheck = run("bun", ["x", "tsc", "--noEmit", "-p", "tsconfig.json"]);
if (typecheck.status !== 0) {
  const text = `${typecheck.stdout ?? ""}\n${typecheck.stderr ?? ""}`;
  const diagnostic = firstTscDiagnostic(text);
  if (diagnostic) annotate(diagnostic);
  else console.error(`::error::typecheck failed`);
  const frame = text.split("\n").filter((line) => line.trim()).slice(0, 12);
  console.error(frame.join("\n"));
  process.exit(typecheck.status ?? 1);
}
if (listed === "[]") {
  console.log("no affected tests");
  process.exit(0);
}
const targets = listed === "ALL" ? [] : JSON.parse(listed);
const tested = run("bun", ["test", "--bail=1", "--only-failures", ...targets]);
if (tested.status !== 0) {
  const text = `${tested.stdout ?? ""}\n${tested.stderr ?? ""}`;
  const failure = firstTestFailure(text, process.cwd());
  if (failure) annotate(failure);
  else console.error("::error::test failed");
  console.error(text.trim());
  process.exit(tested.status ?? 1);
}
console.log(listed === "ALL" ? "affected tests: ALL" : `affected tests: ${listed}`);
}

if (process.argv[1]?.endsWith("ci-os-test.mjs")) main();
