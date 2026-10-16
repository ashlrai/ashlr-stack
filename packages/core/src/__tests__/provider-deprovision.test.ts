import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import { StackError } from "../errors.ts";
import { addService } from "../pipeline.ts";
import type { LogEvent, ProviderContext } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import supabase from "../providers/supabase.ts";
import turso from "../providers/turso.ts";
import vercel from "../providers/vercel.ts";
import { setupFakePhantom } from "./_harness.ts";

const inertPreconnect: typeof fetch.preconnect = () => {
  throw new Error("Unexpected fetch preconnect in inert fixture.");
};

const token = "synthetic-token-sentinel";
const resourceSentinel = "synthetic-password-query-sentinel";
const fixtures = [
  {
    provider: vercel,
    resource: resourceSentinel,
    url: `https://api.vercel.com/v9/projects/${resourceSentinel}`,
    successful: [204],
    unconfirmed: [200, 202, 404, 410, 401, 403, 429, 500],
  },
  {
    provider: supabase,
    resource: resourceSentinel,
    url: `https://api.supabase.com/v1/projects/${resourceSentinel}`,
    successful: [200],
    unconfirmed: [204, 202, 404, 410, 401, 403, 429, 500],
  },
  {
    provider: turso,
    resource: `synthetic-org/${resourceSentinel}`,
    url: `https://api.turso.tech/v1/organizations/synthetic-org/databases/${resourceSentinel}`,
    successful: [200, 404],
    unconfirmed: [204, 202, 410, 401, 403, 429, 500],
  },
];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function inertResponse(status: number, bodyReads: { count: number }): Response {
  const response = new Response(null, { status });
  for (const method of ["text", "json", "arrayBuffer", "blob", "formData"] as const) {
    Object.defineProperty(response, method, {
      value: () => {
        bodyReads.count++;
        throw new Error("synthetic-response-body-secret-sentinel");
      },
    });
  }
  return response;
}

function context(logs: LogEvent[], cwd = process.cwd()): ProviderContext {
  return { cwd, interactive: false, log: (event) => logs.push(event) };
}

describe("provider deletion completion (inert fetch only)", () => {
  for (const fixture of fixtures) {
    const { provider } = fixture;
    for (const status of fixture.successful) {
      test(`${provider.name} admits documented HTTP ${status} with one exact DELETE`, async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const bodyReads = { count: 0 };
        const logs: LogEvent[] = [];
        globalThis.fetch = Object.assign(
          async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init });
            return inertResponse(status, bodyReads);
          },
          { preconnect: inertPreconnect },
        );
        await provider.deprovision?.(context(logs), { token }, fixture.resource);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(fixture.url);
        expect(calls[0].init?.method).toBe("DELETE");
        expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(`Bearer ${token}`);
        expect(calls[0].init?.body).toBeUndefined();
        expect(bodyReads.count).toBe(0);
        expect(logs).toEqual([]);
      });
    }

    test(`${provider.name} refuses unsupported completion, permission and server statuses`, async () => {
      for (const status of fixture.unconfirmed) {
        let contacts = 0;
        const bodyReads = { count: 0 };
        const logs: LogEvent[] = [];
        globalThis.fetch = Object.assign(
          async () => {
            contacts++;
            return inertResponse(status, bodyReads);
          },
          { preconnect: inertPreconnect },
        );
        const error = await provider
          .deprovision?.(context(logs), { token }, fixture.resource)
          .then(() => undefined)
          .catch((error: unknown) => error);
        expect(error).toBeInstanceOf(StackError);
        expect(error).toMatchObject({ code: `${provider.name.toUpperCase()}_DELETE_FAILED` });
        expect((error as Error).message).toBe(
          `${provider.displayName} resource deletion failed (HTTP ${status}).`,
        );
        expect((error as Error).cause).toBeUndefined();
        expect(contacts).toBe(1);
        expect(bodyReads.count).toBe(0);
        expect(logs).toEqual([]);
      }
    });

    test(`${provider.name} refuses Error and non-Error transport outcomes without credential output`, async () => {
      for (const failure of [
        new Error(`synthetic-transport-secret-sentinel ${token} ${resourceSentinel}`),
        {
          token,
          resourceSentinel,
          url: "https://user:password-sentinel@example.invalid/?query=secret",
        },
      ]) {
        let contacts = 0;
        const logs: LogEvent[] = [];
        globalThis.fetch = Object.assign(
          async () => {
            contacts++;
            throw failure;
          },
          { preconnect: inertPreconnect },
        );
        const error = await provider
          .deprovision?.(context(logs), { token }, fixture.resource)
          .then(() => undefined)
          .catch((error: unknown) => error);
        expect(error).toBeInstanceOf(StackError);
        expect(error).toMatchObject({ code: `${provider.name.toUpperCase()}_DELETE_UNCONFIRMED` });
        expect((error as Error).message).toBe(
          `${provider.displayName} resource deletion could not be confirmed.`,
        );
        expect((error as Error).cause).toBeUndefined();
        expect(contacts).toBe(1);
        expect(logs).toEqual([]);
      }
    });
  }

  test("Turso refuses only originally rejected missing components before contact", async () => {
    let contacts = 0;
    const logs: LogEvent[] = [];
    globalThis.fetch = Object.assign(
      async () => {
        contacts++;
        throw new Error("an invalid selector must not contact the provider");
      },
      { preconnect: inertPreconnect },
    );
    for (const resource of ["", "missing-db-secret-sentinel", "/missing-org-secret", "org/"]) {
      const error = await turso
        .deprovision?.(context(logs), { token }, resource)
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(StackError);
      expect(error).toMatchObject({ code: "TURSO_DELETE_ID_INVALID" });
      expect((error as Error).message).toBe(
        "Turso resource deletion requires an organization and database.",
      );
    }
    expect(contacts).toBe(0);
    expect(logs).toEqual([]);
  });

  test("Turso retains the existing extra-segment routing behavior", async () => {
    const calls: string[] = [];
    globalThis.fetch = Object.assign(
      async (url: string | URL | Request) => {
        calls.push(String(url));
        return new Response(null, { status: 200 });
      },
      { preconnect: inertPreconnect },
    );
    await turso.deprovision?.(context([]), { token }, "synthetic-org/synthetic-db/ignored-segment");
    expect(calls).toEqual([
      "https://api.turso.tech/v1/organizations/synthetic-org/databases/synthetic-db",
    ]);
  });
});

describe("provider deletion failure in the approved pipeline custody guards", () => {
  for (const fixture of fixtures) {
    for (const attached of [false, true]) {
      test(`${fixture.provider.name} ${attached ? "preserves attached resources" : "reports created cleanup as partial"}`, async () => {
        const h = setupFakePhantom();
        const cwd = mkdtempSync(join(tmpdir(), "stack-delete-pipeline-"));
        const name = `delete-fixture-${fixture.provider.name}`;
        const logs: LogEvent[] = [];
        let contacts = 0;
        const bodyReads = { count: 0 };
        let requested: string | undefined;
        globalThis.fetch = Object.assign(
          async () => {
            contacts++;
            return inertResponse(403, bodyReads);
          },
          { preconnect: inertPreconnect },
        );
        providers[name] = async () => ({
          ...fixture.provider,
          name,
          async login() {
            return { token };
          },
          async provision(_ctx, _auth, opts) {
            requested = opts.existingResourceId;
            return { id: fixture.resource, displayName: "synthetic fixture" };
          },
          async materialize() {
            throw new Error("synthetic original materialize failure");
          },
        });
        try {
          await writeConfig(emptyConfig("synthetic-delete"), cwd);
          const configBefore = readFileSync(join(cwd, ".stack.toml"));
          const instanceBefore = readFileSync(join(cwd, ".stack.local.toml"));
          const error = await addService({
            providerName: name,
            cwd,
            interactive: false,
            existingResourceId: attached ? "requested-existing-safe-id" : undefined,
            log: (event) => logs.push(event),
          }).catch((error: unknown) => error);
          expect(error).toMatchObject({ code: "ADD_SERVICE_PARTIAL_FAILURE" });
          const message = (error as Error).message;
          expect(message).toContain("synthetic original materialize failure");
          expect(message).not.toContain("has been torn down");
          expect(message).not.toContain("synthetic-response-body-secret-sentinel");
          if (attached) {
            expect(requested).toBe("requested-existing-safe-id");
            expect(message).toContain("preserved");
            expect(contacts).toBe(0);
          } else {
            expect(requested).toBeUndefined();
            expect(message).toContain("may still exist");
            expect(message).toContain("HTTP 403");
            expect(contacts).toBe(1);
          }
          expect(bodyReads.count).toBe(0);
          expect(logs).toEqual([]);
          expect(h.callsTo("add")).toEqual([]);
          expect(h.callsTo("remove")).toEqual([]);
          expect((await readConfig(cwd)).services[name]).toBeUndefined();
          expect(readFileSync(join(cwd, ".stack.toml"))).toEqual(configBefore);
          expect(readFileSync(join(cwd, ".stack.local.toml"))).toEqual(instanceBefore);
        } finally {
          Reflect.deleteProperty(providers, name);
          h.cleanup();
          rmSync(cwd, { recursive: true, force: true });
        }
      });
    }
  }
});
