import { describe, expect, test } from "bun:test";
import { jsonError } from "../lib/json-error.ts";

describe("jsonError", () => {
  test("wraps an Error as the versioned error payload with only schema and error keys", () => {
    const payload = jsonError(new Error("no .stack.toml here"));
    expect(payload).toEqual({
      schema: "ashlr.stack.error/v1",
      error: "no .stack.toml here",
    });
    expect(Object.keys(payload).sort()).toEqual(["error", "schema"]);
  });

  test("keeps the message of Error subclasses and drops the cause", () => {
    class ProviderFailure extends Error {}
    const payload = jsonError(new ProviderFailure("rate limited", { cause: new Error("429") }));
    expect(payload.error).toBe("rate limited");
    expect(payload).not.toHaveProperty("cause");
  });

  test("edge case: an Error with an empty message yields an empty error string, not a fallback", () => {
    expect(jsonError(new Error(""))).toEqual({ schema: "ashlr.stack.error/v1", error: "" });
  });

  test("error path: non-Error throwables are stringified with String()", () => {
    expect(jsonError("plain string failure").error).toBe("plain string failure");
    expect(jsonError(42).error).toBe("42");
    expect(jsonError(undefined).error).toBe("undefined");
    expect(jsonError(null).error).toBe("null");
  });

  test("error path: a plain object with a message property is not read as an Error", () => {
    // Only real Error instances expose their message; anything else becomes "[object Object]".
    // Pinning this keeps the contract explicit for callers that throw structured objects.
    expect(jsonError({ message: "looks like an error" }).error).toBe("[object Object]");
  });
});
