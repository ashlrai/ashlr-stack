import type { ReactNode } from "react";

/**
 * linkifyPhantom — split a prose string on the word "Phantom" (any case that
 * starts with capital P) and wrap each match in an external anchor to phm.dev.
 * Cheap at render time; keeps the FAQ / HowItWorks answer strings plain text
 * in the source so rewriting copy stays easy.
 *
 * Matches:
 *   Phantom          → linked
 *   Phantom's        → linked (the apostrophe + s trail outside the link)
 *   Phantom Cloud    → linked (just "Phantom"; " Cloud" trails outside)
 * Does NOT match:
 *   phantom (lower)  → left plain (often refers to the CLI binary in code)
 */
const PHANTOM_RE = /\bPhantom\b/g;

export function linkifyPhantom(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PHANTOM_RE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a
        key={`p-${start}`}
        href="https://phm.dev"
        target="_blank"
        rel="noopener"
        className="text-[color:var(--color-ink-100)] underline decoration-dotted decoration-[#3b82f6]/40 underline-offset-4 hover:decoration-[#3b82f6] hover:text-[#3b82f6] transition-colors"
      >
        Phantom
      </a>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 1 ? out[0] : <>{out}</>;
}
