export class StackError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StackError";
    this.code = code;
  }
}

export class ProviderNotFoundError extends StackError {
  constructor(name: string) {
    super("PROVIDER_NOT_FOUND", `No provider registered for "${name}"`);
  }
}

export class PhantomNotInstalledError extends StackError {
  constructor() {
    super(
      "PHANTOM_NOT_INSTALLED",
      "Phantom Secrets is required but not found on PATH. Install with: brew install ashlrai/phantom/phantom",
    );
  }
}

export class ConfigNotFoundError extends StackError {
  constructor(path: string) {
    super("CONFIG_NOT_FOUND", `No .stack.toml at ${path}. Run \`stack init\` first.`);
  }
}
