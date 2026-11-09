import { expect, test } from "bun:test";
import { CUSTOM_ICON_PATHS, getIconPath } from "../src/lib/icons";

test("missing icon name returns null without throwing", () => {
  expect(() => getIconPath("definitely-not-an-icon-slug")).not.toThrow();
  expect(getIconPath("definitely-not-an-icon-slug")).toBeNull();
});

test("missing icon lookups stay null on repeat and for the empty slug", () => {
  expect(getIconPath("definitely-not-an-icon-slug")).toBeNull();
  expect(getIconPath("")).toBeNull();
});

test("custom marks resolve without simple-icons and win over upstream", () => {
  for (const [slug, path] of Object.entries(CUSTOM_ICON_PATHS)) {
    expect(getIconPath(slug)).toBe(path);
  }
});
