import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Item = { id: string; name: string };

type Props = {
  label: string;
  items: Item[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  emptyLabel?: string;
  className?: string;
  /** Не открывать и не менять (например, пока не включена опция «заменить системы»). */
  disabled?: boolean;
  /** Узкая кнопка (панель фильтров). */
  compact?: boolean;
};

/**
 * Компактная кнопка + выпадающая панель с чекбоксами (фильтры справочника и т.п.).
 */
export function MultiSelectDropdown({
  label,
  items,
  selectedIds,
  onToggle,
  onClear,
  emptyLabel = "Все",
  className = "",
  disabled = false,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDocDown);
      return () => document.removeEventListener("mousedown", onDocDown);
    }
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  const filteredItems = query.trim()
    ? items.filter((it) => it.name.toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  const summary = selectedIds.length === 0 ? emptyLabel : `${selectedIds.length} выбрано`;

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-left text-slate-800 shadow-sm hover:border-sky-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600 ${
          compact ? "h-9 py-1.5 text-xs" : "h-10 py-2 text-sm"
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="min-w-0 truncate">
          <span className="text-slate-500 dark:text-slate-400">{label}: </span>
          <span className="font-medium">{summary}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 max-h-60 w-full min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-900"
          role="listbox"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 dark:border-slate-700">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск…"
              className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
              autoComplete="off"
            />
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => onClear()}
                className="shrink-0 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Сбросить
              </button>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filteredItems.map((it) => (
              <label
                key={it.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/80"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(it.id)}
                  onChange={() => onToggle(it.id)}
                  className="rounded border-slate-300 dark:border-slate-600"
                />
                <span className="truncate text-slate-800 dark:text-slate-200">{it.name}</span>
              </label>
            ))}
            {!filteredItems.length && (
              <p className="px-3 py-4 text-center text-xs text-slate-500">Ничего не найдено</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
