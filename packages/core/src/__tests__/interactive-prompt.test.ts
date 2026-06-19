import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import { addService } from "../pipeline.ts";
import type { Provider, ProviderContext, PromptRequest } from "../providers/_base.ts";
import { promptSecret } from "../providers/_helpers.ts";
import { providers } from "../providers/index.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

/**
 * Regression coverage for the interactive-auth hang: a provider's PAT/key
 * paste must go through the host-supplied `ctx.prompt` (which the CLI pauses
 * its spinner around) rather than writing to stderr and blocking on stdin
 * behind a live spinner. See `promptSecret` + `ProviderContext.prompt`.
 */
describe("interactive credential prompting", () => {
  test("promptSecret routes through ctx.prompt, trims, and marks the field secret", async () => {
    const seen: PromptRequest[] = [];
    const ctx: ProviderContext = {
      cwd: ".",
      interactive: true,
      log: () => {},
      prompt: async (req) => {
        seen.push(req);
        return "  tok-abc123  "; // surrounding whitespace must be trimmed off
      },
    };

    const token = await promptSecret(ctx, {
      message: "Paste your access token",
      howTo: "create one at https://example.com/tokens",
    });

    expect(token).toBe("tok-abc123");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      message: "Paste your access token",
      howTo: "create one at https://example.com/tokens",
      secret: true,
    });
  });

  describe("threaded through addService", () => {
    let h: Harness;
    let cwd: string;
    let originalCwd: string;

    beforeEach(async () => {
      h = setupFakePhantom();
      cwd = mkdtempSync(join(tmpdir(), "stack-prompt-"));
      originalCwd = process.cwd();
      process.chdir(cwd);
      await writeConfig(emptyConfig("test-template"), cwd);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      Reflect.deleteProperty(providers, "promptsvc");
      h.cleanup();
    });

    test("addService threads prompt into ctx so login receives the host-entered value", async () => {
      let promptCalls = 0;
      let loginToken: string | undefined;
      const stubProvider: Provider = {
        name: "promptsvc",
        displayName: "Prompt Service",
        category: "database",
        authKind: "pat",
        async login(ctx) {
          // Exactly what every real provider's PAT-paste path now does.
          const token = await promptSecret(ctx, { message: "Paste your Prompt Service token" });
          loginToken = token;
          return { token, identity: { id: "user-1" } };
        },
        async provision() {
          return { id: "res-1", displayName: "res-1" };
        },
        async materialize() {
          // No secrets/mcp keeps the pipeline off the Phantom vault, so this
          // assertion runs identically on every platform.
          return { secrets: {} };
        },
      };
      providers.promptsvc = async () => stubProvider;

      const result = await addService({
        providerName: "promptsvc",
        cwd,
        interactive: true,
        prompt: async () => {
          promptCalls += 1;
          return "host-entered-token";
        },
      });

      expect(result.providerName).toBe("promptsvc");
      // The host's prompt callback was invoked, and its value reached login via
      // ctx → promptSecret — proof the wiring is end to end, not bypassed.
      expect(promptCalls).toBe(1);
      expect(loginToken).toBe("host-entered-token");
    });
  });
});
