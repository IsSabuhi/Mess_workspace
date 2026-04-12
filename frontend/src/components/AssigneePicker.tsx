import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AssigneeCandidate = { id: string; full_name: string };

type Props = {
  value: string;
  onChange: (userId: string) => void;
  candidates: AssigneeCandidate[];
  disabled?: boolean;
  /** Если id выбран, но его нет в candidates (редкий случай). */
  selectedDisplayName?: string | null;
  /** Класс кнопки-триггера. */
  buttonClassName?: string;
};

function useMenuPosition(open: boolean, anchorRef: React.RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);

  const update = useCallback(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const r = anchorRef.current.getBoundingClientRect();
    const gap = 6;
    const below = r.bottom + gap;
    const maxH = Math.min(320, Math.max(120, window.innerHeight - below - 12));
    setPos({
      top: below,
      left: r.left,
      width: Math.max(r.width, 240),
      maxH,
    });
  }, [open, anchorRef]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, update]);

  return pos;
}

const defaultButtonClass =
  "flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm hover:border-sky-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600";

/**
 * Выбор исполнителя: кнопка + выпадающий список с поиском (портал, не обрезается в drawer).
 */
export function AssigneePicker({
  value,
  onChange,
  candidates,
  disabled = false,
  selectedDisplayName = null,
  buttonClassName = defaultButtonClass,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuPos = useMenuPosition(open, anchorRef);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  const mergedCandidates = useMemo(() => {
    if (value && selectedDisplayName && !candidates.some((c) => c.id === value)) {
      return [{ id: value, full_name: selectedDisplayName }, ...candidates];
    }
    return candidates;
  }, [candidates, value, selectedDisplayName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mergedCandidates;
    return mergedCandidates.filter((c) => c.full_name.toLowerCase().includes(q));
  }, [mergedCandidates, query]);

  const selectedLabel = useMemo(() => {
    if (!value) return "Не назначен";
    const c = mergedCandidates.find((x) => x.id === value);
    if (c) return c.full_name;
    return selectedDisplayName ?? "Выбранный пользователь";
  }, [value, mergedCandidates, selectedDisplayName]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxH,
            }}
            role="listbox"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 dark:border-slate-700">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по ФИО…"
                className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                autoComplete="off"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => pick("")}
                className={`flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                  !value ? "bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200" : ""
                }`}
              >
                Не назначен
              </button>
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pick(c.id)}
                  className={`flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    value === c.id ? "bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200" : ""
                  }`}
                >
                  <span className="truncate">{c.full_name}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-slate-500">Никого не найдено</p>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative w-full">
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={buttonClassName}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {menu}
    </div>
  );
}
