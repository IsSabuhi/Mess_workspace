import type { BoardOut, KanbanColumnOut } from "../api/boards";
import type { TaskOut } from "../api/tasks";

const PRIORITY_SORT_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function dueDayKey(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return Number.POSITIVE_INFINITY;
  return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Ближайший срок сверху; в один день — выше приоритет; без срока — внизу, тоже по приоритету. */
export function compareTasksOnBoard(a: TaskOut, b: TaskOut): number {
  const da = dueDayKey(a.due_at);
  const db = dueDayKey(b.due_at);
  if (da !== db) return da - db;
  const pa = PRIORITY_SORT_RANK[a.priority] ?? PRIORITY_SORT_RANK.normal;
  const pb = PRIORITY_SORT_RANK[b.priority] ?? PRIORITY_SORT_RANK.normal;
  if (pa !== pb) return pa - pb;
  const ta = a.due_at ? new Date(a.due_at).getTime() : NaN;
  const tb = b.due_at ? new Date(b.due_at).getTime() : NaN;
  const aHas = Number.isFinite(ta);
  const bHas = Number.isFinite(tb);
  if (aHas && bHas && ta !== tb) return ta - tb;
  return a.title.localeCompare(b.title, "ru");
}

export function formatTaskDueShort(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sortBoardColumns(cols: KanbanColumnOut[]): KanbanColumnOut[] {
  return [...cols].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

export function withExclusiveDoneColumn(cols: KanbanColumnOut[], doneId: string): KanbanColumnOut[] {
  return cols.map((c) => (c.id === doneId ? c : { ...c, is_done_column: false }));
}

export function applyColumnCreated(board: BoardOut, created: KanbanColumnOut): BoardOut {
  let cols = [...board.columns, created];
  if (created.is_done_column) cols = withExclusiveDoneColumn(cols, created.id);
  return { ...board, columns: sortBoardColumns(cols) };
}

export function applyColumnUpdated(board: BoardOut, updated: KanbanColumnOut): BoardOut {
  let cols = board.columns.map((c) => (c.id === updated.id ? updated : c));
  if (updated.is_done_column) cols = withExclusiveDoneColumn(cols, updated.id);
  return { ...board, columns: sortBoardColumns(cols) };
}

export function patchDefaultBoardCache(
  old: BoardOut | undefined,
  boardId: string | undefined,
  patch: (b: BoardOut) => BoardOut,
): BoardOut | undefined {
  if (!old || !boardId || old.id !== boardId) return old;
  return patch(old);
}

export function makeBoardSlug(name: string): string {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (raw.length >= 1) return raw.slice(0, 128);
  return `board_${Date.now().toString(36)}`;
}

export const SORT_COL_PREFIX = "sort-col:";
export const DROP_COL_PREFIX = "drop-col:";
export function sortIdForColumn(columnId: string) {
  return `${SORT_COL_PREFIX}${columnId}`;
}
export function dropIdForColumn(columnId: string) {
  return `${DROP_COL_PREFIX}${columnId}`;
}

export function makeColumnSlug(name: string): string {
  const raw = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (raw.length >= 1) return raw.slice(0, 64);
  return `col_${Date.now().toString(36)}`;
}
