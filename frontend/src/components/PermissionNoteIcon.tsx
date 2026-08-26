import { CircleHelp } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_WIDTH = 288;

/** Иконка с подробным пояснением к праву (hover / focus / клик). Рендер в portal, чтобы не обрезалось скроллом. */
export function PermissionNoteIcon({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);
  const tooltipId = useId();
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const hideSoon = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  const place = () => {
    const anchor = wrapRef.current;
    const tip = tooltipRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - 16);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
    if (left < 8) left = 8;
    const tipH = tip?.offsetHeight ?? 96;
    const below = r.bottom + 8;
    const top = below + tipH > window.innerHeight - 8 ? Math.max(8, r.top - 8 - tipH) : below;
    setCoords({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
  }, [open, note]);

  useEffect(() => {
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      if (tooltipRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex shrink-0 align-middle"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        aria-label="Подробнее об этом праве"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200/80 hover:text-sky-700 dark:hover:bg-slate-700 dark:hover:text-sky-300"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open &&
        createPortal(
          <span
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: Math.min(TOOLTIP_WIDTH, typeof window !== "undefined" ? window.innerWidth - 16 : TOOLTIP_WIDTH),
              visibility: coords ? "visible" : "hidden",
            }}
            className="fixed z-[200] rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-normal leading-relaxed text-slate-700 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            onMouseEnter={show}
            onMouseLeave={hideSoon}
          >
            {note}
          </span>,
          document.body,
        )}
    </span>
  );
}
