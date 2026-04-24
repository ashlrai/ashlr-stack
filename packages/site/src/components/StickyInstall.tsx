import { useEffect, useState } from "react";

/**
 * A condensed install one-liner that pins to the top of the viewport
 * once the hero has scrolled out. Gives every section a one-click path
 * to copy the install command without scrolling back up.
 *
 * Dismissible per-session via sessionStorage.
 */

const INSTALL_CMD = "curl -fsSL stack.ashlr.ai/install.sh | bash";
const DISMISS_KEY = "stack-install-dismissed";

export default function StickyInstall() {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
      return;
    }
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset;
      setVisible(y > 520);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* noop */
    }
  };

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  // Stay mounted for the slide-out; `inert` removes focusable descendants
  // and hides the subtree from assistive tech while the animation plays.
  return (
    <div
      {...(!visible ? { inert: "" as unknown as boolean } : {})}
      aria-hidden={!visible}
      className="fixed top-0 inset-x-0 z-40 pointer-events-none"
      style={{
        transform: visible ? "translateY(0)" : "translateY(-100%)",
        opacity: visible ? 1 : 0,
        transition: "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease",
      }}
    >
      <div
        className="pointer-events-auto"
        style={{
          backgroundColor: "rgba(8, 10, 14, 0.88)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--color-ink-600)",
        }}
      >
        <div className="mx-auto max-w-[1240px] px-6 sm:px-10 h-11 flex items-center gap-3">
          <span className="hidden sm:inline mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-500)]">
            install
          </span>
          <div
            className="flex-1 min-w-0 mono text-[12px] text-[color:var(--color-ink-100)] truncate"
            style={{ borderLeft: "2px solid var(--color-blade-500)", paddingLeft: "12px" }}
          >
            <span className="text-[color:var(--color-blade-400)] select-none">› </span>
            {INSTALL_CMD}
          </div>
          <button
            type="button"
            onClick={copy}
            className={`mono text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors ${
              copied
                ? "border-[color:var(--color-blade-400)] text-[color:var(--color-blade-400)]"
                : "border-[color:var(--color-steel-500)] text-[color:var(--color-ink-200)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)]"
            }`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href="/docs/quickstart"
            className="hidden md:inline mono text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 text-[color:var(--color-ink-300)] hover:text-[color:var(--color-blade-400)]"
          >
            quickstart →
          </a>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install bar"
            className="mono text-[11px] text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-100)] px-2"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
