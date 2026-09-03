import { ArrowDown, ArrowUp } from "lucide-react";

import type { SortDir, SortKey } from "../lib/employeeDirectorySort";

export function DirectorySortHeader({
  column,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  column: SortKey;
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <th
      className="px-3 py-2"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="group inline-flex items-center gap-1 rounded-md px-0.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/80 dark:hover:text-white"
        title={
          active
            ? sortDir === "asc"
              ? "Сортировка: по возрастанию (нажмите для убывания)"
              : "Сортировка: по убыванию (нажмите для возрастания)"
            : `Сортировать по: ${label}`
        }
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          )
        ) : (
          <ArrowUp className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}
