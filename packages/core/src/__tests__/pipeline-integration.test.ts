import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import { addService } from "../pipeline.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * End-to-end pipeline test: register a stub provider, run addService, and
 * verify the .stack.toml + fake vault + .mcp.json all get the right writes.
 */
describe("addService full loop", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-pipeline-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("test-template"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
  });

  test("stub provider runs login → provision → materialize → writes everything", async () => {
    const stubProvider: Provider = {
      name: "stubsvc",
      displayName: "Stub Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "stub-token", identity: { id: "user-1" } };
      },
      async provision() {
        return { id: "stub-resource-1", displayName: "stub-resource-1", region: "us-east-1" };
      },
      async materialize(_ctx, resource) {
        return {
          secrets: {
            STUB_URL: `https://${resource.id}.example.com`,
            STUB_API_KEY: "secret-value",
          },
          mcp: {
            name: "stubsvc",
            type: "stdio",
            command: "npx",
            args: ["-y", "fake-mcp"],
          },
        };
      },
    };

    // Hot-register the stub in the provider loader.
    providers.stubsvc = async () => stubProvider;

    const result = await addService({
      providerName: "stubsvc",
      cwd,
      interactive: false,
    });

    expect(result.providerName).toBe("stubsvc");
    expect(result.resourceId).toBe("stub-resource-1");
    expect(result.secretCount).toBe(2);
    expect(result.mcpWired).toBe(true);

    // Secrets landed in the fake vault.
    const vault = await readVault(h.dir);
    expect(vault.STUB_URL).toBe("https://stub-resource-1.example.com");
    expect(vault.STUB_API_KEY).toBe("secret-value");

    // .stack.toml got an entry.
    const { readConfig } = await import("../config.ts");
    const config = await readConfig(cwd);
    expect(config.services.stubsvc).toBeDefined();
    expect(config.services.stubsvc.resource_id).toBe("stub-resource-1");
    expect(config.services.stubsvc.secrets.sort()).toEqual(["STUB_API_KEY", "STUB_URL"]);
    expect(config.services.stubsvc.mcp).toBe("stubsvc");

    // .mcp.json got merged.
    const mcpRaw = await Bun.file(join(cwd, ".mcp.json")).text();
    const mcp = JSON.parse(mcpRaw) as { mcpServers: Record<string, unknown> };
    expect(mcp.mcpServers.stubsvc).toBeDefined();

    Reflect.deleteProperty(providers, "stubsvc");
  });
});
