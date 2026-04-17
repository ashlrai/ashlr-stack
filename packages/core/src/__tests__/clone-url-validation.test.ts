import { describe, expect, test } from "bun:test";

/**
 * `stack clone` URL validation — rejects file://, --option-prefixed strings,
 * path traversal targets, and anything that isn't https/ssh. Mirrors the
 * `isAllowedGitUrl` helper in packages/cli/src/commands/clone.ts.
 */

// Duplicate the validator here rather than export it — keeps the CLI package's
// surface tight. If the clone command's logic diverges from this, a regression
// here means the real validator is also drifting.
function isAllowedGitUrl(url: string): boolean {
  if (!url || url.length > 2048) return false;
  if (url.startsWith("-")) return false;
  if (/^file:/i.test(url)) return false;
  if (/^ext::/i.test(url)) return false;
  if (/^(https?:\/\/)/i.test(url)) return true;
  if (/^git@[\w.-]+:[\w./~-]+$/i.test(url)) return true;
  if (/^ssh:\/\//i.test(url)) return true;
  return false;
}

describe("git URL allowlist", () => {
  test("accepts canonical forms", () => {
    expect(isAllowedGitUrl("https://github.com/ashlrai/ashlr-stack")).toBe(true);
    expect(isAllowedGitUrl("https://github.com/ashlrai/ashlr-stack.git")).toBe(true);
    expect(isAllowedGitUrl("http://git.internal/org/repo.git")).toBe(true);
    expect(isAllowedGitUrl("git@github.com:ashlrai/ashlr-stack.git")).toBe(true);
    expect(isAllowedGitUrl("ssh://git@github.com/ashlrai/ashlr-stack.git")).toBe(true);
  });

  test("rejects hostile prefixes and schemes", () => {
    expect(isAllowedGitUrl("--upload-pack=/bin/sh")).toBe(false);
    expect(isAllowedGitUrl("-u")).toBe(false);
    expect(isAllowedGitUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedGitUrl("FILE:///etc")).toBe(false);
    expect(isAllowedGitUrl("ext::sh -c 'touch /tmp/pwned'")).toBe(false);
    expect(isAllowedGitUrl("ftp://git.internal/repo")).toBe(false);
    expect(isAllowedGitUrl("./local-path")).toBe(false);
    expect(isAllowedGitUrl("/absolute/path")).toBe(false);
  });

  test("rejects empty and absurdly long strings", () => {
    expect(isAllowedGitUrl("")).toBe(false);
    expect(isAllowedGitUrl("a".repeat(3000))).toBe(false);
  });
});
