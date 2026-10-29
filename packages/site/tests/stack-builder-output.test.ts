import { describe, expect, test } from "bun:test";
import {
  STACK_MCP_PREREQUISITES,
  formatOptionalStackMcp,
  joinProviderReferences,
  planStackAddCommands,
  planJoinedProviderCommands,
} from "../src/lib/stack-builder-output";
import { PROVIDERS } from "../src/lib/providers";
import { PROVIDERS_REF } from "../src/lib/providers-ref";

const canonical = new Set(["supabase", "sentry", "posthog", "resend", "neon"]);

describe("Stack Builder copyable output", () => {
  test("uses the exact supported optional Stack control-plane bootstrap", () => {
    const text = formatOptionalStackMcp(true);
    expect(JSON.parse(text)).toEqual({
      mcpServers: { "ashlr-stack": { command: "ashlr-stack-mcp" } },
    });
    expect(text).not.toContain("phantom://");
    expect(text).not.toContain("mcp run");
    expect(text).not.toContain('"env"');
    expect(STACK_MCP_PREREQUISITES).toContain("`stack`");
    expect(STACK_MCP_PREREQUISITES).toContain("`ashlr-stack-mcp`");
    expect(STACK_MCP_PREREQUISITES).toContain("runtime required by the versions you installed");
  });

  test("detail and recipe requests receive identical Stack bootstrap bytes", () => {
    const detail = formatOptionalStackMcp(true);
    const recipe = formatOptionalStackMcp(["supabase", "sentry"].length > 0);
    expect(recipe).toBe(detail);
    expect((recipe.match(/"ashlr-stack"/g) ?? []).length).toBe(1);
  });

  test("planning is pure and returned lists are detached from later calls", () => {
    const selected = ["supabase", "unknownstub"];
    const supported = new Set(canonical);
    const first = planStackAddCommands(selected, supported);
    expect(selected).toEqual(["supabase", "unknownstub"]);
    expect(supported).toEqual(canonical);
    first.unsupported.push("changed-after-return");
    selected.push("sentry");
    expect(planStackAddCommands(selected, supported)).toEqual({
      commands: "stack add supabase && stack add sentry",
      unsupported: ["unknownstub"],
    });
    expect(supported).toEqual(canonical);
  });

  test("mixed provider choices never fabricate provider MCP transports", () => {
    const text = formatOptionalStackMcp(true);
    const config = JSON.parse(text);
    expect(Object.keys(config.mcpServers)).toEqual(["ashlr-stack"]);
    expect(text).not.toContain("supabase");
    expect(text).not.toContain("sentry");
    expect(text).not.toContain("posthog");
  });

  test("empty and no-MCP selections omit optional bootstrap", () => {
    expect(formatOptionalStackMcp(false)).toBe("");
    expect(planStackAddCommands([], canonical)).toEqual({ commands: "", unsupported: [] });
  });

  test("clearing a selection removes its service from generated output", () => {
    const supabase = PROVIDERS.find(({ name }) => name === "Supabase")!;
    const supported = new Set(PROVIDERS_REF.map(({ name }) => name));
    const selected = [supabase];
    const generate = () => {
      const joined = joinProviderReferences(selected, PROVIDERS_REF);
      return {
        plan: planJoinedProviderCommands(joined, supported),
        mcp: formatOptionalStackMcp(joined.some(({ ref }) => Boolean(ref?.mcp))),
      };
    };

    const before = generate();
    expect(before.plan).toEqual({ commands: "stack add supabase", unsupported: [] });
    expect(JSON.parse(before.mcp)).toEqual({
      mcpServers: { "ashlr-stack": { command: "ashlr-stack-mcp" } },
    });

    selected.pop();
    const after = generate();
    expect(after).toEqual({ plan: { commands: "", unsupported: [] }, mcp: "" });
    expect(JSON.stringify(after)).not.toContain("supabase");
  });

  test("preview catalog metadata cannot turn into claimed provider config", () => {
    const text = formatOptionalStackMcp(true);
    expect(JSON.parse(text)).toEqual({
      mcpServers: { "ashlr-stack": { command: "ashlr-stack-mcp" } },
    });
    expect(text).not.toContain("neon");
  });

  test("one and several selected providers yield one supported add per service", () => {
    expect(planStackAddCommands(["supabase"], canonical).commands).toBe("stack add supabase");
    const two = planStackAddCommands(["supabase", "sentry"], canonical).commands;
    expect(two).toBe("stack add supabase && stack add sentry");
    expect(two).not.toBe("stack add supabase sentry");
  });

  test("unknown catalog stubs never become copyable commands", () => {
    expect(planStackAddCommands(["unknownstub"], canonical)).toEqual({
      commands: "",
      unsupported: ["unknownstub"],
    });
    expect(planStackAddCommands(["supabase", "unknownstub"], canonical)).toEqual({
      commands: "stack add supabase",
      unsupported: ["unknownstub"],
    });
  });

  test("invalid shell names and duplicate selections cannot add extra operations", () => {
    const names = new Set([...canonical, "supabase; echo unsafe"]);
    expect(planStackAddCommands(["supabase", "supabase", "supabase; echo unsafe"], names)).toEqual({
      commands: "stack add supabase",
      unsupported: ["supabase; echo unsafe"],
    });
  });
});

describe("Stack Builder catalog join", () => {
  test("all display cards resolve to their unique canonical reference", () => {
    const joined = joinProviderReferences(PROVIDERS, PROVIDERS_REF);
    expect(joined).toHaveLength(39);
    expect(new Set(joined.map(({ display }) => display.name)).size).toBe(39);
    for (const { display, ref } of joined) {
      expect(ref).toBe(PROVIDERS_REF.find((candidate) => candidate.displayName === display.name));
      expect(ref?.secrets.every((key) => /^[A-Z][A-Z0-9_]*$/.test(key))).toBe(true);
    }
    expect(joined.filter(({ ref }) => Boolean(ref?.mcp))).toHaveLength(9);
    expect(joined.filter(({ ref }) => Boolean(ref?.keyOnly))).toHaveLength(32);
  });

  test("previously synthetic Auth0 and Datadog previews use catalog skeleton keys", () => {
    const joined = joinProviderReferences(PROVIDERS, PROVIDERS_REF);
    const auth0 = joined.find(({ display }) => display.name === "Auth0")?.ref;
    const datadog = joined.find(({ display }) => display.name === "Datadog")?.ref;
    expect(auth0?.secrets).toEqual(["AUTH0_DOMAIN"]);
    expect(datadog?.secrets).toEqual(["DD_API_KEY"]);
    expect(auth0?.dashboard).toBeTruthy();
    expect(datadog?.howTo).toBeTruthy();
    expect(auth0?.secrets).not.toContain("AUTH0_API_KEY");
    expect(datadog?.secrets).not.toContain("DATADOG_API_KEY");
  });

  test("missing and ambiguous catalog identities remain planning-only", () => {
    const unknown = { ...PROVIDERS[0]!, name: "sentry", slug: "unknown-sentry" };
    const auth0 = PROVIDERS.find((provider) => provider.name === "Auth0")!;
    const catalogAuth0 = PROVIDERS_REF.find((provider) => provider.displayName === "Auth0")!;
    const canonical = new Set(PROVIDERS_REF.map(({ name }) => name));

    const missing = joinProviderReferences([unknown], PROVIDERS_REF);
    expect(missing[0]?.ref).toBeNull();
    expect(planJoinedProviderCommands(missing, canonical)).toEqual({
      commands: "",
      unsupported: ["sentry"],
    });

    const duplicateDisplay = joinProviderReferences([auth0, { ...auth0 }], PROVIDERS_REF);
    expect(duplicateDisplay.map(({ ref }) => ref)).toEqual([null, null]);
    expect(planJoinedProviderCommands(duplicateDisplay, canonical)).toEqual({
      commands: "",
      unsupported: ["Auth0"],
    });

    const duplicateRef = joinProviderReferences(
      [auth0],
      [...PROVIDERS_REF, { ...catalogAuth0, name: "auth0-duplicate" }],
    );
    expect(duplicateRef[0]?.ref).toBeNull();
    expect(planJoinedProviderCommands(duplicateRef, canonical).commands).toBe("");
  });

  test("mixed selections emit only canonical commands without mutating catalog input", () => {
    const sourceNames = PROVIDERS.map(({ name }) => name);
    const catalogNames = PROVIDERS_REF.map(({ name }) => name);
    const canonical = new Set(catalogNames);
    const auth0 = PROVIDERS.find((provider) => provider.name === "Auth0")!;
    const datadog = PROVIDERS.find((provider) => provider.name === "Datadog")!;
    const unknown = { ...auth0, name: "unknown", slug: "unknown" };
    const joined = joinProviderReferences([auth0, unknown, datadog], PROVIDERS_REF);
    expect(planJoinedProviderCommands(joined, canonical)).toEqual({
      commands: "stack add auth0 && stack add datadog",
      unsupported: ["unknown"],
    });
    expect(PROVIDERS.map(({ name }) => name)).toEqual(sourceNames);
    expect(PROVIDERS_REF.map(({ name }) => name)).toEqual(catalogNames);
    expect(joined[0]?.ref).toBe(PROVIDERS_REF.find(({ name }) => name === "auth0"));
  });
});
