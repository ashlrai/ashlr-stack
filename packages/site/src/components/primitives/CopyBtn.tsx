import { useState } from "react";

/**
 * Shared clipboard-copy button. Three variants via props:
 *   - default:  px-3 py-1.5 text-[11px]
 *   - compact:  px-2 py-1   text-[10px]
 *   - chrome:   no border, just the flash-on-copy state (for toolbars)
 *
 * All variants animate to "Copied" for 1.4s then reset.
 */

export interface CopyBtnProps {
  text: string;
  label?: string;
  compact?: boolean;
  className?: string;
}

export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
}

export default function CopyBtn({ text, label = "Copy", compact = false, className = "" }: CopyBtnProps) {
  const [done, setDone] = useState(false);
  const sizing = compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]";
  const state = done
    ? "border-[color:var(--color-blade-400)] text-[color:var(--color-blade-400)]"
    : "border-[color:var(--color-steel-500)] text-[color:var(--color-ink-300)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)]";

  return (
    <button
      type="button"
      onClick={async () => {
        await copyToClipboard(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={`mono border tracking-[0.12em] uppercase transition-colors ${sizing} ${state} ${className}`}
    >
      {done ? "Copied" : label}
    </button>
  );
}
