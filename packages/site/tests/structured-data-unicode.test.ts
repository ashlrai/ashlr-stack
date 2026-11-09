import { expect, test } from "bun:test";
import {
  breadcrumbSchema,
  faqPageSchema,
  howToSchema,
  itemListSchema,
  techArticleSchema,
} from "../src/lib/structured-data";

// Mirrors how src/layouts/Base.astro emits each schema into <script type="application/ld+json">.
const emit = (schema: unknown): string => JSON.stringify(schema).replace(/</g, "\\u003c");

// Accents, CJK, RTL, emoji (astral plane / surrogate pair), combining marks, and a lone-`<` tag.
const TEXT = "Café 日本語 مرحبا 🚀 e\u0301 </script><b>";

test("techArticleSchema preserves Unicode text through the emitted JSON", () => {
  const parsed = JSON.parse(
    emit(
      techArticleSchema({
        headline: TEXT,
        description: TEXT,
        url: "https://stack.ashlr.ai/docs/café",
        section: TEXT,
      }),
    ),
  );
  expect(parsed.headline).toBe(TEXT);
  expect(parsed.name).toBe(TEXT);
  expect(parsed.description).toBe(TEXT);
  expect(parsed.articleSection).toBe(TEXT);
  expect(parsed.url).toBe("https://stack.ashlr.ai/docs/café");
});

test("howToSchema preserves Unicode in steps", () => {
  const parsed = JSON.parse(
    emit(
      howToSchema({
        name: TEXT,
        url: "https://stack.ashlr.ai/docs/x",
        steps: [{ name: TEXT, text: TEXT }],
      }),
    ),
  );
  expect(parsed.name).toBe(TEXT);
  expect(parsed.step[0].name).toBe(TEXT);
  expect(parsed.step[0].text).toBe(TEXT);
});

test("faqPageSchema preserves Unicode questions and answers", () => {
  const parsed = JSON.parse(emit(faqPageSchema([{ question: TEXT, answer: `${TEXT}!` }])));
  expect(parsed.mainEntity[0].name).toBe(TEXT);
  expect(parsed.mainEntity[0].acceptedAnswer.text).toBe(`${TEXT}!`);
});

test("itemListSchema preserves Unicode names, descriptions and extras", () => {
  const parsed = JSON.parse(
    emit(
      itemListSchema({
        name: TEXT,
        items: [{ name: TEXT, description: TEXT, extra: { alternateName: "日本語" } }],
      }),
    ),
  );
  expect(parsed.name).toBe(TEXT);
  expect(parsed.itemListElement[0].item.name).toBe(TEXT);
  expect(parsed.itemListElement[0].item.description).toBe(TEXT);
  expect(parsed.itemListElement[0].item.alternateName).toBe("日本語");
});

test("breadcrumbSchema keeps Unicode names and paths", () => {
  const parsed = JSON.parse(emit(breadcrumbSchema([{ name: TEXT, url: "/docs/日本語" }])));
  expect(parsed.itemListElement[0].name).toBe(TEXT);
  expect(parsed.itemListElement[0].item.endsWith("/docs/日本語")).toBe(true);
});

test("emitted JSON never contains a raw `<`, so Unicode text cannot close the script tag", () => {
  const out = emit(faqPageSchema([{ question: TEXT, answer: TEXT }]));
  expect(out).not.toContain("<");
  expect(out).toContain("\\u003c/script>");
});
