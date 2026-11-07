import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { webhookStubFor } from "./phantom-wire.ts";

setDefaultTimeout(30_000);

describe("ai/phantom-wire repeated unknown placeholders", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = setupFakePhantom();
  });
  afterEach(() => {
    harness.cleanup();
  });

  it("keeps both occurrences of repeated unknown placeholders unchanged at every expansion site", () => {
    // A provider name carrying two distinct unknown placeholders. Each must
    // survive all five expansion sites in the stub unchanged (three case-
    // preserving, two uppercased for the reveal lines). The expansion sites
    // are: the title line, the forge line, the handler name (first-letter
    // capitalized), and the two `phantom reveal` lines (uppercased).
    const name = "pre${ALPHA}mid${BETA}post";

    const stub = webhookStubFor(name);

    // Three case-preserving sites: the placeholders keep their original case.
    expect(stub).toContain(`webhook handler stub for ${name}.`);
    expect(stub).toContain("forge a pre${ALPHA}mid${BETA}post webhook.");
    expect(stub).toContain("handlePre${ALPHA}mid${BETA}postWebhook(req: Request)");

    // Two uppercased reveal lines: both placeholders are folded with the
    // surrounding text by `toUpperCase()`, but neither is resolved or lost.
    expect(stub.split("phantom reveal PRE${ALPHA}MID${BETA}POST_WEBHOOK_SECRET").length - 1).toBe(
      2,
    );

    // Every `${...}` token in the stub is one of the two carried placeholders
    // — five expansion sites × two tokens = ten occurrences.
    const tokens = [...stub.matchAll(/\$\{[^}]*\}/g)].map((m) => m[0]);
    expect(tokens).toHaveLength(10);

    // Five occurrences of each token (one per expansion site), each still
    // seated between the surrounding text.
    expect(stub.split("${ALPHA}").length - 1).toBe(5);
    expect(stub.split("${BETA}").length - 1).toBe(5);

    // Lowercased reveal lines: both placeholders folded together.
    expect(stub.toLowerCase().split("${alpha}").length - 1).toBe(5);
    expect(stub.toLowerCase().split("${beta}").length - 1).toBe(5);
  });
});
