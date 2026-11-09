import { expect, test } from "bun:test";
import { verificationHintFor } from "./phantom-wire.ts";

test("unrecognized providers receive generic signature verification guidance", () => {
  expect(verificationHintFor("unrecognized-provider")).toBe(
    "Verify per the provider's documented signature scheme.",
  );
});
