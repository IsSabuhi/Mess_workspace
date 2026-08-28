import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type SearchableSelectItem = { id: string; label: string };

type Props = {
  value: string;
  onChange: (id: string) => void;
  items: SearchableSelectItem[];
  emptyLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
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
  "flex min-w-[12rem] max-w-[18rem] items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm hover:border-sky-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600";

function matchesQuery(label: string, q: string): boolean {
  if (!q) return true;
  return label.toLowerCase().includes(q);
}

/**
 * Одиночный выбор из длинного списка: кнопка + поиск в выпадающей панели.
 */
export function SearchableSelect({
  value,
  onChange,
  items,
  emptyLabel = "Все",
  searchPlaceholder = "Поиск…",
  disabled = false,
  className = "",
  buttonClassName = defaultButtonClass,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuPos = useMenuPosition(open, anchorRef);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
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
    return items.filter((it) => matchesQuery(it.label, q));
  }, [items, query]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const emptyOk = matchesQuery(emptyLabel, q);
    const list: { id: string; label: string }[] = emptyOk ? [{ id: "", label: emptyLabel }, ...filtered] : [...filtered];
    return list;
  }, [emptyLabel, filtered, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const selectedLabel = useMemo(() => {
    if (!value) return emptyLabel;
    return items.find((x) => x.id === value)?.label ?? emptyLabel;
  }, [value, items, emptyLabel]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[highlight];
      if (row) pick(row.id);
    }
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
                onKeyDown={onSearchKeyDown}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
                autoComplete="off"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {rows.map((row, idx) => (
                <button
                  key={row.id || "__empty__"}
                  type="button"
                  onClick={() => pick(row.id)}
                  onMouseEnter={() => setHighlight(idx)}
                  className={`flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    value === row.id
                      ? "bg-sky-50 font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                      : idx === highlight
                        ? "bg-slate-50 dark:bg-slate-800/80"
                        : ""
                  }`}
                >
                  <span className="truncate">{row.label}</span>
                </button>
              ))}
              {rows.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-slate-500">Ничего не найдено</p>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`relative ${className}`}>
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
