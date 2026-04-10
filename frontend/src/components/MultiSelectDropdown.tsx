import { ChevronDown } from "lucide-react";
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
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const summary = selectedIds.length === 0 ? emptyLabel : `${selectedIds.length} выбрано`;

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm hover:border-sky-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-sky-600"
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
          <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1.5 dark:border-slate-700">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {label}
            </span>
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={() => onClear()}
                className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Сбросить
              </button>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {items.map((it) => (
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
            {!items.length && (
              <p className="px-3 py-4 text-center text-xs text-slate-500">Нет данных</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
