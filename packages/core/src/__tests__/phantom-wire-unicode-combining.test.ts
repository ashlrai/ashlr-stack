import { expect, it, describe } from "bun:test";
import { webhookStubFor, verificationHintFor } from "../ai/phantom-wire.ts";

/**
 * Helper: return the sequence of code point values in a string.
 */
function codePoints(str: string): number[] {
  return [...str].map((ch) => ch.codePointAt(0) as number);
}

describe("webhookStubFor — replacement value with Unicode combining character", () => {
  // "café" spelled as base "e" + U+0301 (combining acute accent) = 5 code points.
  // This is the NFD (decomposed) form; NFC would fuse e + U+0301 into é (U+00E9).
  const name = "cafe\u0301";
  const expectedCodePoints = [99, 97, 102, 101, 769]; // c, a, f, e, ́

  it("preserves the original code points in every expansion site", () => {
    const stub = webhookStubFor(name);
    expect(stub).not.toContain("${");

    // 1. The plain provider name (5 code points, not normalized to NFC).
    const plainLines = stub.split("\n").filter((l) => l.includes("webhook handler stub for"));
    expect(plainLines).toHaveLength(1);
    const plainMatch = plainLines[0].match(/stub for (cafe\u0301)\./);
    expect(plainMatch).not.toBeNull();
    expect(codePoints(plainMatch![1])).toEqual(expectedCodePoints);

    // 2. The capitalized provider name — first character upper-cased,
    //    remaining code points (including the combining character) intact.
    //    "café" → "Café" = C, a, f, e, U+0301
    const capExpected = [67, 97, 102, 101, 769]; // C, a, f, e, ́
    const capLines = stub.split("\n").filter((l) => l.includes("handleCaf"));
    expect(capLines).toHaveLength(1);
    // Extract the function name: "handleCaféWebhook"
    const fnMatch = capLines[0].match(/handle(Cafe\u0301)Webhook/);
    expect(fnMatch).not.toBeNull();
    expect(codePoints(fnMatch![1])).toEqual(capExpected);

    // 3. The secret key name — uppercased provider + _WEBHOOK_SECRET.
    //    toUpperCase() on the combining mark (U+0301) returns itself.
    const secretExpected = "CAFE\u0301_WEBHOOK_SECRET";
    const revealLines = stub.split("\n").filter((l) => l.includes("phantom reveal"));
    expect(revealLines).toHaveLength(2);
    for (const line of revealLines) {
      expect(line).toContain(secretExpected);
    }

    // 4. The forge line — plain provider name again.
    const forgeLines = stub.split("\n").filter((l) => l.includes("forge a"));
    expect(forgeLines).toHaveLength(1);
    const forgeMatch = forgeLines[0].match(/forge a (cafe\u0301) webhook/);
    expect(forgeMatch).not.toBeNull();
    expect(codePoints(forgeMatch![1])).toEqual(expectedCodePoints);
  });

  it("does not NFC-normalize the combining character", () => {
    // NFC normalization would fuse e + U+0301 into é (U+00E9), changing 5
    // code points to 4. The rendered result must keep the original 5.
    const stub = webhookStubFor(name);
    // The stub must contain the decomposed sequence (length 5), not the
    // precomposed é (U+00E9).
    expect(stub).toContain(name);
    expect(stub).not.toContain("café"); // NFC form with precomposed é
    // Capitalized decomposed: C + a + f + e + U+0301
    expect(stub).toContain("Cafe\u0301Webhook");
  });

  it("yields the same code point count in the rendered stub as in the input", () => {
    // The input name has 5 code points; every occurrence in the rendered
    // stub (plain, capitalized, uppercase) must also have 5 code points.
    const stub = webhookStubFor(name);
    const inputLength = name.length; // 5 (iterable characters = code points)
    expect(inputLength).toBe(5);

    // Extract each expansion from the stub and verify the length.
    const plainMatch = stub.match(/stub for (cafe\u0301)\./);
    expect(plainMatch![1].length).toBe(inputLength);

    const capMatch = stub.match(/handle(Cafe\u0301)Webhook/);
    expect(capMatch![1].length).toBe(inputLength);

    const secretMatch = stub.match(/phantom reveal (CAFE\u0301_WEBHOOK_SECRET)/);
    // The secret is the uppercased name + _WEBHOOK_SECRET, so the name
    // portion still has 5 code points.
    const secretNamePart = secretMatch![1].replace("_WEBHOOK_SECRET", "");
    expect(secretNamePart.length).toBe(inputLength);
  });
});

describe("verificationHintFor — provider with combining character", () => {
  it("returns the generic fallback without interpolating the provider name", () => {
    // An unknown provider (including one with combining characters) hits
    // the default branch, which returns a fixed string with no placeholders.
    const name = "cafe\u0301";
    const hint = verificationHintFor(name);
    expect(hint).toBe("Verify per the provider's documented signature scheme.");
    expect(hint).not.toContain(name);
    expect(hint).not.toContain("${");
  });
});
