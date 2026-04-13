import { ChevronDown, Search, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { AssigneeCandidate } from "./AssigneePicker";

type Props = {
  value: string[];
  onChange: (userIds: string[]) => void;
  candidates: AssigneeCandidate[];
  disabled?: boolean;
  /** Текущий пользователь — для кнопки «Назначить себя» */
  selfId?: string | null;
  selfDisplayName?: string;
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

const btnAddClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-600 dark:hover:bg-sky-950/40";

const btnSelfClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 shadow-sm hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-900/50";

/**
 * Несколько исполнителей: чипы, «Назначить себя», выпадающий список для добавления.
 */
export function MultiAssigneePicker({
  value,
  onChange,
  candidates,
  disabled = false,
  selfId = null,
  selfDisplayName = "себя",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuPos = useMenuPosition(open, anchorRef);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c] as const)), [candidates]);

  const chips = useMemo(() => {
    return value.map((id) => {
      const c = byId.get(id);
      return { id, label: c?.full_name ?? id };
    });
  }, [value, byId]);

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

  const addable = useMemo(() => {
    const set = new Set(value);
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => {
      if (set.has(c.id)) return false;
      if (!q) return true;
      return c.full_name.toLowerCase().includes(q);
    });
  }, [candidates, value, query]);

  function add(id: string) {
    if (value.includes(id)) return;
    onChange([...value, id]);
    setOpen(false);
  }

  function remove(id: string) {
    onChange(value.filter((x) => x !== id));
  }

  function assignSelf() {
    if (!selfId || disabled) return;
    if (value.includes(selfId)) return;
    onChange([...value, selfId]);
  }

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
              {addable.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => add(c.id)}
                  className="flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="truncate">{c.full_name}</span>
                </button>
              ))}
              {addable.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-slate-500">
                  {candidates.length === value.length ? "Все из списка уже назначены" : "Никого не найдено"}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {selfId && (
          <button
            type="button"
            disabled={disabled || value.includes(selfId)}
            onClick={assignSelf}
            className={btnSelfClass}
          >
            <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Назначить себя
            {value.includes(selfId) ? " (уже в списке)" : ` (${selfDisplayName})`}
          </button>
        )}
        <button
          ref={anchorRef}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={btnAddClass}
          aria-expanded={open}
        >
          <span>Добавить исполнителя</span>
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map(({ id, label }) => (
            <li
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(id)}
                className="shrink-0 rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50 dark:hover:bg-slate-600 dark:hover:text-slate-100"
                aria-label={`Убрать ${label}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">Исполнители не назначены</p>
      )}
      {menu}
    </div>
  );
}
