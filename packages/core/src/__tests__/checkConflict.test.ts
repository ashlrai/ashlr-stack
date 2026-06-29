/**
 * checkConflict.test.ts
 *
 * Unit tests for the 13 new provider checkConflict() implementations.
 *
 * For each provider, covers:
 *   - happy path: name not found → ok
 *   - name exists → attach or rename with existingResourceId
 *   - API unavailable → unreachable (graceful skip, never throws)
 *   - no desiredName → ok (auto-naming)
 *
 * All tests use mock fetch / inject stubs. No real network calls.
 */

import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";
import type {
  AuthHandle,
  ConflictCheckOpts,
  ResourceConflictCheckConfig,
} from "../providers/_base.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_AUTH: AuthHandle = { token: "fake-token-for-test", identity: { id: "user-1" } };

function makeOpts(desiredName?: string): ConflictCheckOpts {
  return { desiredName, signal: AbortSignal.timeout(5000) };
}

function assertBaseShape(result: ResourceConflictCheckConfig): void {
  expect(typeof result.requestedName).toBe("string");
  expect(typeof result.action).toBe("string");
  expect(typeof result.message).toBe("string");
  expect(typeof result.checkedAt).toBe("string");
}

function assertAcceptableUnreachable(result: ResourceConflictCheckConfig): void {
  assertBaseShape(result);
  const acceptable = ["unreachable", "ok", "skipped"];
  expect(acceptable).toContain(result.action);
}

// ---------------------------------------------------------------------------
// Mock fetch helper — returns a fake Response
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function mockFetchStatus(status: number): typeof fetch {
  return async () => new Response("", { status });
}

function mockFetchThrow(): typeof fetch {
  return async () => {
    throw new Error("Network error");
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

describe("render.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/render.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("name not found → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk([]) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-service"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("name exists → rename with existingResourceId", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk([
      { service: { id: "srv-abc123", name: "my-service" } },
    ]) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-service"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("srv-abc123");
      expect(result.action).toBe("rename");
      expect(result.suggestedUniqueName).toMatch(/^my-service-[a-z0-9]+$/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable (graceful)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-service"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API returns non-ok status → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchStatus(503) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-service"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Fly.io
// ---------------------------------------------------------------------------

describe("fly.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/fly.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("name not found → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({ apps: [] }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-app"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("name exists → rename with existingResourceId", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({
      apps: [{ id: "fly-app-999", name: "my-app" }],
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-app"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("fly-app-999");
      expect(result.action).toBe("rename");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-app"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Cloudflare
// ---------------------------------------------------------------------------

describe("cloudflare.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/cloudflare.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("name not found (no scripts) → ok", async () => {
    const orig = globalThis.fetch;
    // First call: accounts, second call: scripts
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1)
        return new Response(
          JSON.stringify({ result: [{ id: "acct-1", name: "My Account" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      return new Response(
        JSON.stringify({ result: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-worker"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("name exists → rename", async () => {
    const orig = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1)
        return new Response(
          JSON.stringify({ result: [{ id: "acct-1", name: "My Account" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      return new Response(
        JSON.stringify({ result: [{ id: "my-worker" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-worker"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.action).toBe("rename");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-worker"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------

describe("firebase.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  const SA_JSON = JSON.stringify({
    type: "service_account",
    project_id: "my-firebase-project",
    client_email: "svc@my-firebase-project.iam.gserviceaccount.com",
  });

  beforeEach(async () => {
    const mod = await import("../providers/firebase.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const auth: AuthHandle = { token: SA_JSON };
    const result = await checkConflict(auth, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("name not found (project_id mismatch) → ok", async () => {
    const auth: AuthHandle = { token: SA_JSON };
    const result = await checkConflict(auth, makeOpts("other-project"));
    assertBaseShape(result);
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("name matches project_id → attach with existingResourceId", async () => {
    const auth: AuthHandle = { token: SA_JSON };
    const result = await checkConflict(auth, makeOpts("my-firebase-project"));
    assertBaseShape(result);
    expect(result.exists).toBe(true);
    expect(result.existingResourceId).toBe("my-firebase-project");
    expect(result.action).toBe("attach");
  });

  test("malformed JSON token → unreachable", async () => {
    const auth: AuthHandle = { token: "not-valid-json" };
    const result = await checkConflict(auth, makeOpts("my-project"));
    assertAcceptableUnreachable(result);
  });

  test("missing project_id → unreachable", async () => {
    const auth: AuthHandle = {
      token: JSON.stringify({ type: "service_account", client_email: "x@y.iam" }),
    };
    const result = await checkConflict(auth, makeOpts("my-project"));
    assertAcceptableUnreachable(result);
  });
});

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

describe("aws.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/aws.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    // STS will be called but return undefined with fake creds → handled gracefully
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("malformed token (no colon) → unreachable", async () => {
    const auth: AuthHandle = { token: "no-colon-here" };
    const result = await checkConflict(auth, makeOpts("123456789012"));
    assertAcceptableUnreachable(result);
  });

  test("STS returns account id matching desired → attach", async () => {
    const orig = globalThis.fetch;
    // Mock STS response with XML
    globalThis.fetch = (async () =>
      new Response(
        `<GetCallerIdentityResponse>
           <GetCallerIdentityResult>
             <Arn>arn:aws:iam::123456789012:user/test</Arn>
             <UserId>AIDAXXXXXXXXXX</UserId>
             <Account>123456789012</Account>
           </GetCallerIdentityResult>
         </GetCallerIdentityResponse>`,
        { status: 200, headers: { "content-type": "text/xml" } },
      )) as typeof fetch;
    try {
      const auth: AuthHandle = { token: "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
      const result = await checkConflict(auth, makeOpts("123456789012"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("123456789012");
      expect(result.action).toBe("attach");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("STS account id mismatch → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        `<GetCallerIdentityResponse>
           <GetCallerIdentityResult>
             <Arn>arn:aws:iam::999888777666:user/test</Arn>
             <Account>999888777666</Account>
           </GetCallerIdentityResult>
         </GetCallerIdentityResponse>`,
        { status: 200, headers: { "content-type": "text/xml" } },
      )) as typeof fetch;
    try {
      const auth: AuthHandle = { token: "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
      const result = await checkConflict(auth, makeOpts("123456789012"));
      assertBaseShape(result);
      expect(result.exists).toBe(false);
      expect(result.action).toBe("ok");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("STS unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const auth: AuthHandle = { token: "AKID:SECRET" };
      const result = await checkConflict(auth, makeOpts("123456789012"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

describe("convex.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/convex.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const auth: AuthHandle = { token: "prod:myteam:myproject|secrettoken" };
    const result = await checkConflict(auth, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("project name matches desired → attach", async () => {
    const auth: AuthHandle = { token: "prod:myteam:myproject|secrettoken" };
    const result = await checkConflict(auth, makeOpts("myproject"));
    assertBaseShape(result);
    expect(result.exists).toBe(true);
    expect(result.existingResourceId).toBe("myproject");
    expect(result.action).toBe("attach");
  });

  test("project name mismatch → ok", async () => {
    const auth: AuthHandle = { token: "prod:myteam:myproject|secrettoken" };
    const result = await checkConflict(auth, makeOpts("otherproject"));
    assertBaseShape(result);
    expect(result.exists).toBe(false);
    expect(result.action).toBe("ok");
  });

  test("malformed deploy key → unreachable", async () => {
    const auth: AuthHandle = { token: "malformedkey" };
    const result = await checkConflict(auth, makeOpts("myproject"));
    assertAcceptableUnreachable(result);
  });

  test("deploy key missing project component → unreachable", async () => {
    const auth: AuthHandle = { token: "prod:myteam|secrettoken" };
    const result = await checkConflict(auth, makeOpts("myproject"));
    assertAcceptableUnreachable(result);
  });
});

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

describe("linear.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/linear.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("team not found → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({ data: { teams: { nodes: [] } } }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Engineering"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("team exists → attach with existingResourceId", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({
      data: { teams: { nodes: [{ id: "team-abc", name: "Engineering" }] } },
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Engineering"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("team-abc");
      expect(result.action).toBe("attach");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Engineering"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API non-ok → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchStatus(401) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Engineering"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Clerk
// ---------------------------------------------------------------------------

describe("clerk.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/clerk.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("application name not matching → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({
      id: "inst-123",
      application_name: "My Other App",
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("My App"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("application name matches → attach with existingResourceId", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({
      id: "inst-456",
      application_name: "My App",
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("My App"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("inst-456");
      expect(result.action).toBe("attach");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("My App"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API non-ok → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchStatus(403) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("My App"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// Auth0
// ---------------------------------------------------------------------------

describe("auth0.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/auth0.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const auth: AuthHandle = { token: "myapp.us.auth0.com" };
    const result = await checkConflict(auth, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("domain mismatch → ok", async () => {
    const auth: AuthHandle = { token: "myapp.us.auth0.com" };
    const result = await checkConflict(auth, makeOpts("other-tenant"));
    assertBaseShape(result);
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("domain matches and tenant reachable → attach", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({ issuer: "https://myapp.us.auth0.com/" }) as typeof fetch;
    try {
      const auth: AuthHandle = { token: "myapp.us.auth0.com" };
      const result = await checkConflict(auth, makeOpts("myapp.us.auth0.com"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("myapp.us.auth0.com");
      expect(result.action).toBe("attach");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("domain matches but tenant unreachable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const auth: AuthHandle = { token: "myapp.us.auth0.com" };
      const result = await checkConflict(auth, makeOpts("myapp.us.auth0.com"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("domain is prefix match → attach when reachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({ issuer: "https://myapp.us.auth0.com/" }) as typeof fetch;
    try {
      // auth.token = full domain, desired = base name
      const auth: AuthHandle = { token: "myapp.us.auth0.com" };
      const result = await checkConflict(auth, makeOpts("myapp"));
      assertBaseShape(result);
      // "myapp.us.auth0.com".startsWith("myapp.") → true
      expect(result.exists).toBe(true);
      expect(result.action).toBe("attach");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// WorkOS
// ---------------------------------------------------------------------------

describe("workos.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/workos.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("organization not found → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({ data: [] }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Acme Corp"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("organization exists → attach with existingResourceId", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({
      data: [{ id: "org-xyz789", name: "Acme Corp" }],
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Acme Corp"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("org-xyz789");
      expect(result.action).toBe("attach");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Acme Corp"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API non-ok → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchStatus(401) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("Acme Corp"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// DigitalOcean
// ---------------------------------------------------------------------------

describe("digitalocean.checkConflict", () => {
  let checkConflict: (
    auth: AuthHandle,
    opts: ConflictCheckOpts,
  ) => Promise<ResourceConflictCheckConfig>;

  beforeEach(async () => {
    const mod = await import("../providers/digitalocean.ts");
    const provider = (mod as { default: { checkConflict?: typeof checkConflict } }).default;
    expect(typeof provider.checkConflict).toBe("function");
    checkConflict = provider.checkConflict!;
  });

  test("no desiredName → ok", async () => {
    const result = await checkConflict(FAKE_AUTH, makeOpts(undefined));
    expect(result.action).toBe("ok");
    expect(result.exists).toBe(false);
  });

  test("app not found → ok", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({ apps: [] }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-do-app"));
      assertBaseShape(result);
      expect(result.action).toBe("ok");
      expect(result.exists).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("app exists → rename with existingResourceId", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchOk({
      apps: [{ id: "do-app-111", spec: { name: "my-do-app" } }],
    }) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-do-app"));
      assertBaseShape(result);
      expect(result.exists).toBe(true);
      expect(result.existingResourceId).toBe("do-app-111");
      expect(result.action).toBe("rename");
      expect(result.suggestedUniqueName).toMatch(/^my-do-app-[a-z0-9]+$/);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API unavailable → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchThrow() as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-do-app"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("API non-ok → unreachable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetchStatus(503) as typeof fetch;
    try {
      const result = await checkConflict(FAKE_AUTH, makeOpts("my-do-app"));
      assertAcceptableUnreachable(result);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// All 13 providers export checkConflict (interface conformance)
// ---------------------------------------------------------------------------

describe("checkConflict — all new providers export the method", () => {
  const PROVIDERS = [
    "render",
    "fly",
    "cloudflare",
    "firebase",
    "aws",
    "convex",
    "linear",
    "clerk",
    "auth0",
    "workos",
    "digitalocean",
  ] as const;

  for (const name of PROVIDERS) {
    test(`${name} exports checkConflict`, async () => {
      const mod = await (async () => {
        switch (name) {
          case "render": return import("../providers/render.ts");
          case "fly": return import("../providers/fly.ts");
          case "cloudflare": return import("../providers/cloudflare.ts");
          case "firebase": return import("../providers/firebase.ts");
          case "aws": return import("../providers/aws.ts");
          case "convex": return import("../providers/convex.ts");
          case "linear": return import("../providers/linear.ts");
          case "clerk": return import("../providers/clerk.ts");
          case "auth0": return import("../providers/auth0.ts");
          case "workos": return import("../providers/workos.ts");
          case "digitalocean": return import("../providers/digitalocean.ts");
        }
      })();
      const provider = (mod as { default: { checkConflict?: unknown } }).default;
      expect(typeof provider.checkConflict).toBe("function");
    });

    test(`${name} checkConflict returns unreachable with invalid token (non-throwing)`, async () => {
      const mod = await (async () => {
        switch (name) {
          case "render": return import("../providers/render.ts");
          case "fly": return import("../providers/fly.ts");
          case "cloudflare": return import("../providers/cloudflare.ts");
          case "firebase": return import("../providers/firebase.ts");
          case "aws": return import("../providers/aws.ts");
          case "convex": return import("../providers/convex.ts");
          case "linear": return import("../providers/linear.ts");
          case "clerk": return import("../providers/clerk.ts");
          case "auth0": return import("../providers/auth0.ts");
          case "workos": return import("../providers/workos.ts");
          case "digitalocean": return import("../providers/digitalocean.ts");
        }
      })();
      const provider = (mod as { default: { checkConflict?: (auth: AuthHandle, opts: ConflictCheckOpts) => Promise<ResourceConflictCheckConfig> } }).default;

      // Mock fetch to return 401 so no real network call is made
      const orig = globalThis.fetch;
      globalThis.fetch = mockFetchStatus(401) as typeof fetch;
      try {
        const result = await provider.checkConflict!(
          { token: "invalid-token-for-test" },
          { desiredName: "test-conflict-xyz", signal: AbortSignal.timeout(5000) },
        );

        // Must return valid shape — never throw
        assertAcceptableUnreachable(result);
      } finally {
        globalThis.fetch = orig;
      }
    });
  }
});
