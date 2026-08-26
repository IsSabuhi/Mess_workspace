import { ChevronDown, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onCreate?: (name: string) => Promise<string> | string;
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
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
    const maxH = Math.min(320, Math.max(140, window.innerHeight - below - 12));
    setPos({
      top: below,
      left: r.left,
      width: Math.max(r.width, 220),
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
  "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-sm outline-none ring-sky-400/30 hover:border-sky-300 focus:border-sky-400 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:border-sky-600";

export function CreatableSearchSelect({
  value,
  options,
  onChange,
  onCreate,
  placeholder = "Выберите…",
  emptyLabel = "Не указано",
  searchPlaceholder = "Поиск или новая…",
  disabled = false,
  buttonClassName = defaultButtonClass,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
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
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, query]);

  const canCreate = useMemo(() => {
    const q = query.trim();
    if (!q || !onCreate) return false;
    return !options.some((opt) => opt.toLowerCase() === q.toLowerCase());
  }, [onCreate, options, query]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const create = async () => {
    const q = query.trim();
    if (!q || !onCreate || creating) return;
    setCreating(true);
    try {
      const created = await onCreate(q);
      pick(created.trim() || q);
    } finally {
      setCreating(false);
    }
  };

  const selectedLabel = value.trim() || emptyLabel;

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[220] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-900"
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
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const q = query.trim();
                  const exact = options.find((opt) => opt.toLowerCase() === q.toLowerCase());
                  if (exact) pick(exact);
                  else if (canCreate) void create();
                  else if (filtered.length === 1) pick(filtered[0]);
                }}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                autoComplete="off"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => pick("")}
                className={`flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                  !value.trim()
                    ? "bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                    : "text-slate-500"
                }`}
              >
                {emptyLabel}
              </button>
              {filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pick(opt)}
                  className={`flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    value.trim().toLowerCase() === opt.toLowerCase()
                      ? "bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                      : ""
                  }`}
                >
                  <span className="truncate">{opt}</span>
                </button>
              ))}
              {filtered.length === 0 && !canCreate && (
                <p className="px-3 py-4 text-center text-xs text-slate-500">Ничего не найдено</p>
              )}
            </div>
            {canCreate && (
              <button
                type="button"
                disabled={creating}
                onClick={() => void create()}
                className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-60 dark:border-slate-700 dark:text-sky-300 dark:hover:bg-sky-950/40"
              >
                <Plus className="h-4 w-4 shrink-0" />
                {creating ? "Создаю…" : `Создать «${query.trim()}»`}
              </button>
            )}
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
        <span className={`min-w-0 flex-1 truncate ${value.trim() ? "" : "text-slate-400"}`}>
          {value.trim() ? selectedLabel : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {menu}
    </div>
  );
}
