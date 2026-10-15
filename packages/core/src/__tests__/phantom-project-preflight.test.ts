import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import { addSecret } from "../phantom.ts";
import { addService } from "../pipeline.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("project metadata before provider contact", () => {
  let h: Harness;
  let cwd: string;
  const contacts = { login: 0, provision: 0, materialize: 0, deprovision: 0 };

  beforeEach(async () => {
    h = setupFakePhantom({}, { initialized: false });
    cwd = mkdtempSync(join(tmpdir(), "stack-preflight-"));
    await writeConfig(emptyConfig(), cwd);
    contacts.login = contacts.provision = contacts.materialize = contacts.deprovision = 0;
    const provider: Provider = {
      name: "preflightfixture",
      displayName: "Inert fixture",
      category: "ai",
      authKind: "api_key",
      async login() {
        contacts.login++;
        return { token: "synthetic" };
      },
      async provision() {
        contacts.provision++;
        return { id: "synthetic", displayName: "fixture" };
      },
      async materialize() {
        contacts.materialize++;
        return { secrets: { NEW_KEY: "synthetic" } };
      },
      async deprovision() {
        contacts.deprovision++;
      },
    };
    providers.preflightfixture = async () => provider;
  });

  afterEach(() => {
    Reflect.deleteProperty(providers, "preflightfixture");
    h.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  });

  test("uninitialized config refuses login and provisioning without initializing a vault", async () => {
    const before = readFileSync(join(cwd, ".stack.toml"), "utf8");
    await expect(addService({ providerName: "preflightfixture", cwd })).rejects.toMatchObject({
      code: "PHANTOM_PROJECT_NOT_INITIALIZED",
    });
    expect(contacts).toEqual({ login: 0, provision: 0, materialize: 0, deprovision: 0 });
    expect(h.callsTo("status")).toEqual([{ cmd: "status", args: ["--json"] }]);
    expect(h.callsTo("init")).toEqual([]);
    expect(h.callsTo("add")).toEqual([]);
    expect(h.callsTo("list")).toEqual([]);
    expect(readFileSync(join(cwd, ".stack.toml"), "utf8")).toBe(before);
  });

  test.each([
    "not-json",
    '{"schema_version":1,"inspection":"metadata-only"}',
    '{"schema_version":2,"inspection":"metadata-only","initialized":true}',
    '{"schema_version":1,"inspection":"metadata-only","initialized":"true"}',
    '{"schema_version":1,"inspection":"vault-health","initialized":true}',
  ])("unknown metadata refuses all provider contact (%s)", async (status) => {
    writeFileSync(
      join(h.dir, "phantom"),
      `#!/bin/sh\ncase "$1" in --version) echo fixture;; *) printf '%s' '${status}';; esac\n`,
    );
    await expect(addService({ providerName: "preflightfixture", cwd })).rejects.toMatchObject({
      code: "PHANTOM_METADATA_UNAVAILABLE",
    });
    expect(contacts).toEqual({ login: 0, provision: 0, materialize: 0, deprovision: 0 });
    expect((await readConfig(cwd)).services.preflightfixture).toBeUndefined();
  });

  test("signal-terminated storage never commits pipeline configuration", async () => {
    writeFileSync(
      join(h.dir, "phantom"),
      `#!/bin/sh
case "$1" in
 --version) echo fixture;;
 status) echo '{"schema_version":1,"inspection":"metadata-only","initialized":true}';;
 *) kill -TERM $$;;
esac
`,
    );
    await expect(addService({ providerName: "preflightfixture", cwd })).rejects.toMatchObject({
      code: "ADD_SERVICE_ROLLED_BACK",
    });
    expect(contacts).toEqual({ login: 1, provision: 1, materialize: 1, deprovision: 1 });
    expect((await readConfig(cwd)).services.preflightfixture).toBeUndefined();
  });

  test("cached collision output followed by signal cannot commit pipeline configuration", async () => {
    await addSecret("NEW_KEY", "synthetic", cwd);
    writeFileSync(
      join(h.dir, "phantom"),
      `#!/bin/sh
case "$1" in
 status) echo '{"schema_version":1,"inspection":"metadata-only","initialized":true}';;
 *) echo 'already protected' >&2; kill -TERM $$;;
esac
`,
    );
    await expect(addService({ providerName: "preflightfixture", cwd })).rejects.toMatchObject({
      code: "ADD_SERVICE_ROLLED_BACK",
    });
    expect(contacts).toEqual({ login: 1, provision: 1, materialize: 1, deprovision: 1 });
    expect((await readConfig(cwd)).services.preflightfixture).toBeUndefined();
  });
});
