import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { addSecret } from "../phantom.ts";
import { bearerJsonHeaders, tryRevealSecret } from "../providers/_helpers.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

/**
 * The `_helpers` module backs every provider's PAT/API-key flow. Regressions
 * here would silently corrupt secret reads across the catalog.
 */

describe("provider helpers", () => {
  let h: Harness;
  beforeEach(() => {
    h = setupFakePhantom({ PRESENT_KEY: "hello-world" });
  });
  afterEach(() => h.cleanup());

  test("tryRevealSecret returns the value when present", async () => {
    expect(await tryRevealSecret("PRESENT_KEY")).toBe("hello-world");
  });

  test("tryRevealSecret returns undefined for an empty value", async () => {
    await addSecret("EMPTY_KEY", "");
    expect(await tryRevealSecret("EMPTY_KEY")).toBeUndefined();
  });

  test("tryRevealSecret returns undefined rather than throwing when phantom fails", async () => {
    // Never-stored key — phantom reveal returns an empty string, helper returns undefined.
    expect(await tryRevealSecret("NEVER_STORED_KEY")).toBeUndefined();
  });

  test("bearerJsonHeaders returns the canonical shape", () => {
    const headers = bearerJsonHeaders("my-token") as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-token");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
  });
});
