import { describe, expect, test } from "bun:test";
import {
  ConfigNotFoundError,
  PhantomNotInstalledError,
  ProviderNotFoundError,
  SourceDirectoryNotFoundError,
  StackError,
} from "../errors.ts";

describe("StackError", () => {
  test("carries a machine-readable code alongside the message", () => {
    const err = new StackError("SOME_CODE", "something broke");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StackError);
    expect(err.name).toBe("StackError");
    expect(err.code).toBe("SOME_CODE");
    expect(err.message).toBe("something broke");
  });

  test("edge: omitting options leaves no cause on the error", () => {
    const err = new StackError("SOME_CODE", "no cause given");
    expect("cause" in err).toBe(false);
    expect(err.cause).toBeUndefined();
  });

  test("forwards an explicit cause from options", () => {
    const root = new Error("disk full");
    const err = new StackError("SOME_CODE", "wrapped", { cause: root });
    expect(err.cause).toBe(root);
  });
});

describe("ProviderNotFoundError", () => {
  test("uses the PROVIDER_NOT_FOUND code and names the provider", () => {
    const err = new ProviderNotFoundError("acme");
    expect(err).toBeInstanceOf(StackError);
    expect(err.code).toBe("PROVIDER_NOT_FOUND");
    expect(err.message).toBe('No provider registered for "acme"');
  });

  test("edge: an empty provider name still produces a well-formed message", () => {
    const err = new ProviderNotFoundError("");
    expect(err.code).toBe("PROVIDER_NOT_FOUND");
    expect(err.message).toBe('No provider registered for ""');
  });
});

describe("PhantomNotInstalledError", () => {
  test("uses the PHANTOM_NOT_INSTALLED code and includes the install command", () => {
    const err = new PhantomNotInstalledError();
    expect(err).toBeInstanceOf(StackError);
    expect(err.code).toBe("PHANTOM_NOT_INSTALLED");
    expect(err.message).toContain("not found on PATH");
    expect(err.message).toContain("brew install ashlrai/phantom/phantom");
  });
});

describe("ConfigNotFoundError", () => {
  test("uses the CONFIG_NOT_FOUND code and points at the missing path and stack init", () => {
    const err = new ConfigNotFoundError("/work/app/.stack.toml");
    expect(err).toBeInstanceOf(StackError);
    expect(err.code).toBe("CONFIG_NOT_FOUND");
    expect(err.message).toBe("No .stack.toml at /work/app/.stack.toml. Run `stack init` first.");
  });
});

describe("SourceDirectoryNotFoundError", () => {
  test("error path: keeps the underlying failure as cause so callers can inspect it", () => {
    const fsError = new Error("ENOENT: no such file or directory");
    const err = new SourceDirectoryNotFoundError("/missing/src", { cause: fsError });
    expect(err).toBeInstanceOf(StackError);
    expect(err.code).toBe("SOURCE_DIRECTORY_NOT_FOUND");
    expect(err.message).toBe("Source directory not found: /missing/src");
    expect(err.cause).toBe(fsError);
  });

  test("is catchable by code when thrown", () => {
    const thrower = () => {
      throw new SourceDirectoryNotFoundError("/missing/src");
    };
    let caught: unknown;
    try {
      thrower();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StackError);
    expect((caught as StackError).code).toBe("SOURCE_DIRECTORY_NOT_FOUND");
    expect((caught as Error).cause).toBeUndefined();
  });
});
