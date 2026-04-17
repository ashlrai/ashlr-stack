import type { MouseEvent, ReactNode } from "react";
import { useRef } from "react";

/**
 * Magnetic button — deflects toward the cursor on hover (max 6px offset). A
 * restrained version of the effect — just enough to feel alive without being
 * toy-like. Falls back to a plain button in reduced-motion.
 */
interface Props {
  href?: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  dataCopy?: string;
  maxOffset?: number;
}

export default function MagneticButton({
  href,
  onClick,
  className = "",
  children,
  dataCopy,
  maxOffset = 6,
}: Props) {
  const ref = useRef<HTMLElement | null>(null);

  const handleMove = (e: MouseEvent) => {
    if (typeof window !== "undefined") {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
    }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    const cap = (n: number) => Math.max(-maxOffset, Math.min(maxOffset, n));
    el.style.transform = `translate(${cap(x * 0.25)}px, ${cap(y * 0.4)}px)`;
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
  };

  const commonProps = {
    className: `magnet ${className}`,
    onMouseMove: handleMove,
    onMouseLeave: handleLeave,
  };

  if (href) {
    return (
      <a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={href}
        {...commonProps}
        {...(dataCopy ? { "data-copy": dataCopy } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type="button"
      onClick={onClick}
      {...commonProps}
      {...(dataCopy ? { "data-copy": dataCopy } : {})}
    >
      {children}
    </button>
  );
}
