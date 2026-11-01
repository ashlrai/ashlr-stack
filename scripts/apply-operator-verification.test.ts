import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(import.meta.dir, "../docs/apply-operator-verification.md");
const doc = readFileSync(path, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

describe("post-apply operator verification", () => {
  it("links the changelog and local recovery guidance", () => {
    expect(doc).toContain("../CHANGELOG.md#030-2026-10-31");
    expect(changelog).toContain("## 0.3.0 (2026-10-31)");
    for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      expect(existsSync(resolve(dirname(path), match[1])), match[1]).toBe(true);
    }
  });

  it("distinguishes unchecked inventory, missing names, and credential validity", () => {
    expect(doc).toContain("`--noWire` skips the inventory check and");
    expect(doc).toContain("Skipped providers");
    expect(doc).toContain("unknown inventory, not missing or present values");
    expect(doc).toContain("missing secret names alone do not");
    expect(doc).toContain("`phantom add <NAME>`");
    expect(doc).toContain("enter the real value when prompted");
    expect(doc).toContain("A name in Phantom only proves");
    expect(doc).toContain("actual\n  application or deployment identity");
    expect(doc).not.toMatch(/phantom add[^`\n]*TODO_STACK_APPLY/);
  });

  it("requires resolving failures and verifying webhook authentication", () => {
    expect(doc).toContain("rollback is best");
    expect(doc).toContain("does not delete upstream resources");
    expect(doc).toContain("do not mark unchecked services ready");
    expect(doc).toContain("test provider-specific signature verification before accepting traffic");
    expect(doc).toContain("owner and follow-up");
  });
});
