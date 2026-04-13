import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Pencil, Tags, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client";
import {
  createBoardColumn,
  deleteBoardColumn,
  getDefaultBoard,
  updateBoardColumn,
} from "../api/boards";
import type { BoardOut, KanbanColumnOut } from "../api/boards";
import { listSystems } from "../api/systems";
import { createTaskTag, deleteTaskTag, listTaskTags, updateTaskTag } from "../api/taskTags";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "../api/tasks";
import type { TaskCreate, TaskOut, TaskUpdate } from "../api/tasks";
import { listAssigneeCandidates } from "../api/users";
import { MultiAssigneePicker } from "../components/MultiAssigneePicker";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  PERM,
  canDeleteTask,
  canManageBoardColumns,
  canMoveTask,
  canUpdateTask,
  hasPermission,
} from "../lib/permissions";
import { formatAssigneesLabel } from "../lib/taskAssignees";
import { taskIsOverdueForDashboard } from "../lib/taskStatus";
import { toastApiError, toastError, toastSuccess } from "../lib/toast";

const PRIORITY_LABEL: Record<string, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
  urgent: "Срочный",
};

const PRIORITY_BADGE_CLASS: Record<TaskOut["priority"], string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  normal: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  urgent: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
};

type TaskTagView = { id: string; name: string; color: string };

/** Префиксы id, чтобы не пересекаться с uuid задач и дроп-зонами колонок */
const SORT_COL_PREFIX = "sort-col:";
const DROP_COL_PREFIX = "drop-col:";
function sortIdForColumn(columnId: string) {
  return `${SORT_COL_PREFIX}${columnId}`;
}
function dropIdForColumn(columnId: string) {
  return `${DROP_COL_PREFIX}${columnId}`;
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): string | null {
  if (!s.trim()) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function queryErr(e: unknown): string | null {
  if (e instanceof ApiError) return e.detail;
  if (e) return "Ошибка загрузки";
  return null;
}

/** Slug для API колонки: ^[a-z0-9_]+$ */
function makeColumnSlug(name: string): string {
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

function ColumnDropArea({ columnId, children }: { columnId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: dropIdForColumn(columnId) });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-1 flex-col gap-2 rounded-xl p-1 pb-2 transition-colors ${
        isOver ? "bg-sky-50/90 ring-2 ring-sky-400/70 dark:bg-sky-950/30 dark:ring-sky-600" : ""
      }`}
    >
      {children}
    </div>
  );
}

function DraggableTaskCard({
  task,
  canDrag,
  onOpen,
  moveButtons,
  canDelete,
  onDelete,
  isOverdue,
}: {
  task: TaskOut;
  canDrag: boolean;
  onOpen: () => void;
  moveButtons?: React.ReactNode;
  canDelete?: boolean;
  onDelete?: () => void;
  isOverdue?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canDrag,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
  };
  const assigneesLine = formatAssigneesLabel(task);
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "z-10 opacity-90" : ""}>
      <div
        className={`flex gap-1 rounded-xl border p-2 text-sm shadow-sm transition ${
          isOverdue
            ? "border-red-200 bg-red-50/70 hover:border-red-300 dark:border-red-900/50 dark:bg-red-950/30 dark:hover:border-red-700"
            : "border-slate-100 bg-white hover:border-sky-200 hover:shadow-md dark:border-slate-600 dark:bg-slate-800/80 dark:hover:border-sky-700"
        }`}
      >
        {canDrag ? (
          <button
            type="button"
            className="touch-none shrink-0 cursor-grab rounded-lg px-1.5 py-2 text-slate-400 hover:bg-slate-100 active:cursor-grabbing dark:hover:bg-slate-700"
            aria-label="Перетащить"
            {...listeners}
            {...attributes}
          >
            ⋮⋮
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 gap-1">
          <button
            type="button"
            onClick={() => onOpen()}
            className="min-w-0 flex-1 rounded-lg p-1 text-left"
          >
            <p className="font-medium text-slate-900 dark:text-white">{task.title}</p>
            {task.system && (
              <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">{task.system.name}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {isOverdue && (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  Просрочено
                </span>
              )}
              {assigneesLine && (
                <span className="truncate" title={(task.assignees ?? []).map((a) => a.full_name).join(", ")}>
                  {assigneesLine}
                </span>
              )}
              <span
                className={`rounded px-1.5 py-0.5 ${PRIORITY_BADGE_CLASS[task.priority] ?? PRIORITY_BADGE_CLASS.normal}`}
              >
                {PRIORITY_LABEL[task.priority] ?? task.priority}
              </span>
            </div>
            {task.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                {task.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full px-1.5 py-0.5"
                    style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                  >
                    #{tag.name}
                  </span>
                ))}
                {task.tags.length > 4 && (
                  <span className="text-slate-500 dark:text-slate-400">+{task.tags.length - 4}</span>
                )}
              </div>
            )}
          </button>
          {canDelete && onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="shrink-0 self-start rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              aria-label="Удалить задачу"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>
      {moveButtons}
    </div>
  );
}

function SortableColumnShell({
  column,
  canReorder,
  children,
}: {
  column: KanbanColumnOut;
  canReorder: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortIdForColumn(column.id),
    disabled: !canReorder,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 25 : undefined,
  };
  const dragHandle = canReorder ? (
    <button
      type="button"
      className="touch-none shrink-0 cursor-grab rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 active:cursor-grabbing dark:hover:bg-slate-700"
      aria-label="Переместить колонку"
      {...listeners}
      {...attributes}
    >
      <GripVertical className="h-4 w-4" strokeWidth={2} />
    </button>
  ) : null;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex min-h-[calc(100vh-11rem)] w-72 shrink-0 flex-col rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 ${
        isDragging ? "shadow-lg ring-2 ring-sky-400/40 dark:ring-sky-600/40" : ""
      }`}
    >
      {children(dragHandle)}
    </div>
  );
}

export function TasksPage() {
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const qc = useQueryClient();

  const [filterSystem, setFilterSystem] = useState<string>("");
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  /** Пусто — все задачи; иначе показываются задачи, у которых есть хотя бы один из выбранных тегов */
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [tagFilterExpanded, setTagFilterExpanded] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnSlug, setNewColumnSlug] = useState("");
  const [newColumnIsDone, setNewColumnIsDone] = useState(false);
  const [columnEdit, setColumnEdit] = useState<KanbanColumnOut | null>(null);
  const [editColumnName, setEditColumnName] = useState("");
  const [editColumnIsDone, setEditColumnIsDone] = useState(false);
  const [title, setTitle] = useState("");
  const [systemId, setSystemId] = useState("");
  const [columnId, setColumnId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerTask, setDrawerTask] = useState<TaskOut | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<TaskOut["priority"]>("normal");
  const [editDue, setEditDue] = useState("");
  const [editSystemId, setEditSystemId] = useState("");
  const [editColumnId, setEditColumnId] = useState("");
  const [editAssigneeIds, setEditAssigneeIds] = useState<string[]>([]);
  const [editTagIds, setEditTagIds] = useState<string[]>([]);

  const [formError, setFormError] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#38bdf8");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [activeDragTask, setActiveDragTask] = useState<TaskOut | null>(null);
  const [activeDragColumn, setActiveDragColumn] = useState<KanbanColumnOut | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const canCreate = user && hasPermission(user, PERM.TASKS_CREATE);
  const canManageCols = !!user && canManageBoardColumns(user);
  /** Руководитель / полный доступ к задачам: все системы и явный выбор при создании */
  const canViewAllSystems = !!(
    user &&
    (user.is_superuser ||
      hasPermission(user, PERM.TASKS_READ_ALL) ||
      hasPermission(user, PERM.TASKS_UPDATE_ALL))
  );

  const tasksQueryKey = useMemo(() => ["tasks", user?.id ?? ""] as const, [user?.id]);

  const boardQuery = useQuery({ queryKey: ["board", "default"], queryFn: getDefaultBoard });
  const tasksQuery = useQuery({
    queryKey: tasksQueryKey,
    queryFn: () => listTasks({ include_archived: false }),
  });
  const systemsQuery = useQuery({
    queryKey: ["systems"],
    queryFn: () => listSystems(true),
    enabled: canViewAllSystems,
  });
  const assigneeCandidatesQuery = useQuery({
    queryKey: ["users", "assignee-candidates", user?.id],
    queryFn: listAssigneeCandidates,
    enabled: !!user,
  });
  const tagsQuery = useQuery({
    queryKey: ["task-tags"],
    queryFn: listTaskTags,
    enabled: !!user,
  });

  const board = boardQuery.data ?? null;
  const tasks = tasksQuery.data ?? [];
  const boardSystems = useMemo(() => {
    if (!user) return [];
    if (canViewAllSystems) return systemsQuery.data ?? [];
    return user.systems ?? [];
  }, [user, canViewAllSystems, systemsQuery.data]);

  /** Исполнитель: с бэкенда — все сотрудники (руководитель) или участники тех же систем; иначе только «я» */
  const assigneeChoices = useMemo((): { id: string; full_name: string }[] => {
    if (!user) return [];
    const fromApi = (assigneeCandidatesQuery.data ?? []).map((x) => ({
      id: x.id,
      full_name: x.full_name,
    }));
    if (fromApi.length > 0) {
      const hasSelf = fromApi.some((u) => u.id === user.id);
      return hasSelf ? fromApi : [{ id: user.id, full_name: `${user.full_name} (я)` }, ...fromApi];
    }
    return [{ id: user.id, full_name: `Я (${user.full_name})` }];
  }, [user, assigneeCandidatesQuery.data]);

  const loading =
    boardQuery.isPending ||
    tasksQuery.isPending ||
    (canViewAllSystems && systemsQuery.isPending);
  const loadError =
    queryErr(boardQuery.error) ??
    queryErr(tasksQuery.error) ??
    (canViewAllSystems ? queryErr(systemsQuery.error) : null) ??
    queryErr(assigneeCandidatesQuery.error) ??
    queryErr(tagsQuery.error);

  useEffect(() => {
    if (boardSystems.length && !systemId) setSystemId(boardSystems[0].id);
  }, [boardSystems, systemId]);

  useEffect(() => {
    if (!filterSystem) return;
    if (!boardSystems.some((s) => s.id === filterSystem)) setFilterSystem("");
  }, [boardSystems, filterSystem]);

  useEffect(() => {
    const available = new Set((tagsQuery.data ?? []).map((t) => t.id));
    setFilterTagIds((prev) => prev.filter((id) => available.has(id)));
  }, [tagsQuery.data]);

  useEffect(() => {
    const cols = board?.columns ?? [];
    const sorted = [...cols].sort((a, b) => a.sort_order - b.sort_order);
    if (sorted.length && !columnId) setColumnId(sorted[0].id);
  }, [board, columnId]);

  const deleteMut = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onSuccess: (_, taskId) => {
      qc.setQueriesData<TaskOut[]>({ queryKey: tasksQueryKey }, (old) =>
        old ? old.filter((t) => t.id !== taskId) : old,
      );
      /* Без немедленного refetch: ответ GET мог перезаписать кэш старым списком (как при переносе карточки). */
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
      setDrawerTaskId((prev) => (prev === taskId ? null : prev));
      setDrawerTask((prev) => (prev?.id === taskId ? null : prev));
      toastSuccess("Задача удалена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить задачу"),
  });

  const addColumnMut = useMutation({
    mutationFn: (body: { name: string; slug: string; sort_order: number; is_done_column?: boolean }) => {
      if (!board?.id) throw new Error("Доска не загружена");
      return createBoardColumn(board.id, body);
    },
    onSuccess: (created) => {
      qc.setQueryData<BoardOut>(["board", "default"], (old) => {
        if (!old) return old;
        let cols = [...old.columns, created];
        if (created.is_done_column) {
          cols = cols.map((c) => (c.id === created.id ? c : { ...c, is_done_column: false }));
        }
        cols.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
        return { ...old, columns: cols };
      });
      void qc.invalidateQueries({ queryKey: ["board", "default"], refetchType: "none" });
      setColumnModalOpen(false);
      setNewColumnName("");
      setNewColumnSlug("");
      setNewColumnIsDone(false);
      toastSuccess("Колонка добавлена");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError && e.status === 409) toastError("Колонка с таким кодом уже есть");
      else toastApiError(e, "Не удалось добавить колонку");
    },
  });

  const deleteColumnMut = useMutation({
    mutationFn: (columnId: string) => {
      if (!board?.id) throw new Error("Доска не загружена");
      return deleteBoardColumn(board.id, columnId);
    },
    onSuccess: (_, columnId) => {
      qc.setQueryData<BoardOut>(["board", "default"], (old) =>
        old ? { ...old, columns: old.columns.filter((c) => c.id !== columnId) } : old,
      );
      void qc.invalidateQueries({ queryKey: ["board", "default"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
      toastSuccess("Колонка удалена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить колонку"),
  });

  const updateColumnMut = useMutation({
    mutationFn: ({
      columnId,
      body,
    }: {
      columnId: string;
      body: { name?: string; is_done_column?: boolean };
    }) => {
      if (!board?.id) throw new Error("Доска не загружена");
      return updateBoardColumn(board.id, columnId, body);
    },
    onSuccess: (updated) => {
      qc.setQueryData<BoardOut>(["board", "default"], (old) => {
        if (!old) return old;
        let cols = old.columns.map((c) => (c.id === updated.id ? updated : c));
        if (updated.is_done_column) {
          cols = cols.map((c) => (c.id === updated.id ? c : { ...c, is_done_column: false }));
        }
        cols = [...cols].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
        return { ...old, columns: cols };
      });
      qc.setQueriesData<TaskOut[]>({ queryKey: tasksQueryKey }, (old) =>
        old?.map((t) => {
          if (t.column_id !== updated.id) return t;
          return {
            ...t,
            column: {
              id: updated.id,
              name: updated.name,
              slug: updated.slug,
              is_done_column: updated.is_done_column,
            },
          };
        }) ?? old,
      );
      void qc.invalidateQueries({ queryKey: ["board", "default"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
      setColumnEdit(null);
      toastSuccess("Колонка обновлена");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить колонку"),
  });

  const reorderColsMut = useMutation({
    mutationFn: async (ordered: KanbanColumnOut[]) => {
      if (!board?.id) throw new Error("Доска не загружена");
      for (let i = 0; i < ordered.length; i++) {
        await updateBoardColumn(board.id, ordered[i].id, { sort_order: i });
      }
      return ordered.map((c, i) => ({ ...c, sort_order: i }));
    },
    onSuccess: (withOrder) => {
      qc.setQueryData<BoardOut>(["board", "default"], (old) => (old ? { ...old, columns: withOrder } : old));
      void qc.invalidateQueries({ queryKey: ["board", "default"], refetchType: "none" });
      toastSuccess("Порядок колонок сохранён");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось изменить порядок колонок"),
  });

  const moveMut = useMutation({
    mutationFn: ({ id, column_id }: { id: string; column_id: string }) => updateTask(id, { column_id }),
    onSuccess: (updated) => {
      const uid = String(updated.id);
      qc.setQueryData<TaskOut[]>(tasksQueryKey, (old) => {
        if (!old) return old;
        return old.map((t) => (String(t.id) === uid ? { ...t, ...updated } : t));
      });
      /* Не делаем сразу refetch списка: браузерный HTTP-кэш GET мог вернуть старый список и перезатереть PATCH.
         Ответ PATCH уже содержит актуальную задачу. Помечаем запрос устаревшим для фоновой синхронизации. */
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setFormError(e.detail);
      else setFormError("Не удалось переместить");
      toastApiError(e, "Не удалось переместить задачу");
    },
  });

  const createMut = useMutation({
    mutationFn: createTask,
    onSuccess: (created) => {
      qc.setQueriesData<TaskOut[]>({ queryKey: tasksQueryKey }, (old) => {
        if (!old) return [created];
        if (old.some((t) => t.id === created.id)) {
          return old.map((t) => (t.id === created.id ? { ...t, ...created } : t));
        }
        return [...old, created];
      });
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
      setModalOpen(false);
      setTitle("");
      setTagIds([]);
      setAssigneeIds([]);
      setFormError(null);
      toastSuccess("Задача создана");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setFormError(e.detail);
      else setFormError("Не удалось создать задачу");
      toastApiError(e, "Не удалось создать задачу");
    },
  });

  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskUpdate }) => updateTask(id, body),
    onSuccess: (data) => {
      setDrawerTask(data);
      qc.setQueriesData<TaskOut[]>({ queryKey: tasksQueryKey }, (old) =>
        old ? old.map((t) => (t.id === data.id ? { ...t, ...data } : t)) : old,
      );
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
      setFormError(null);
      toastSuccess("Задача сохранена");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiError) setFormError(e.detail);
      else setFormError("Не удалось сохранить");
      toastApiError(e, "Не удалось сохранить задачу");
    },
  });

  const columns = board?.columns ?? [];
  const sortedCols = useMemo(
    () => [...columns].sort((a, b) => a.sort_order - b.sort_order),
    [columns],
  );

  const tasksByColumn = useMemo(() => {
    const m = new Map<string, TaskOut[]>();
    for (const c of sortedCols) m.set(c.id, []);
    for (const t of tasks) {
      if (filterSystem && t.system_id !== filterSystem) continue;
      if (showOverdueOnly && !taskIsOverdueForDashboard(t)) continue;
      if (filterTagIds.length > 0) {
        const taskTagIds = new Set(t.tags.map((x) => x.id));
        const matches = filterTagIds.some((id) => taskTagIds.has(id));
        if (!matches) continue;
      }
      const arr = m.get(t.column_id);
      if (arr) arr.push(t);
    }
    return m;
  }, [tasks, sortedCols, filterSystem, showOverdueOnly, filterTagIds]);

  const overdueById = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      if (taskIsOverdueForDashboard(t)) s.add(t.id);
    }
    return s;
  }, [tasks]);

  async function openDrawer(task: TaskOut) {
    setDrawerTaskId(task.id);
    setDrawerTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditPriority(task.priority);
    setEditDue(toLocalInput(task.due_at));
    setEditSystemId(task.system_id);
    setEditColumnId(task.column_id);
    setEditAssigneeIds(task.assignees?.map((a) => a.id) ?? []);
    setEditTagIds(task.tags.map((t) => t.id));
    setDrawerLoading(true);
    try {
      const fresh = await getTask(task.id);
      setDrawerTask(fresh);
      setEditTitle(fresh.title);
      setEditDescription(fresh.description ?? "");
      setEditPriority(fresh.priority);
      setEditDue(toLocalInput(fresh.due_at));
      setEditSystemId(fresh.system_id);
      setEditColumnId(fresh.column_id);
      setEditAssigneeIds(fresh.assignees?.map((a) => a.id) ?? []);
      setEditTagIds(fresh.tags.map((t) => t.id));
    } catch {
      /* оставляем данные с карточки */
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerTaskId(null);
    setDrawerTask(null);
  }

  function saveDrawer() {
    if (!user || !drawerTaskId || !drawerTask) return;
    if (!canUpdateTask(user, drawerTask)) return;
    saveMut.mutate({
      id: drawerTaskId,
      body: {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        priority: editPriority,
        due_at: fromLocalInput(editDue),
        system_id: editSystemId,
        column_id: editColumnId,
        assignee_ids: editAssigneeIds,
        tag_ids: editTagIds,
      },
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!columnId) return;
    if (!canViewAllSystems && boardSystems.length === 0) return;

    let resolvedSid: string | undefined;
    if (!canViewAllSystems && boardSystems.length === 1) {
      resolvedSid = boardSystems[0].id;
    } else {
      if (!systemId) return;
      resolvedSid = systemId;
    }

    const body: TaskCreate = {
      title: title.trim(),
      column_id: columnId,
      assignee_ids: assigneeIds,
      tag_ids: tagIds,
    };
    if (resolvedSid) body.system_id = resolvedSid;
    createMut.mutate(body);
  }

  function moveTask(task: TaskOut, col: KanbanColumnOut) {
    if (!user || !canMoveTask(user, task)) return;
    if (task.column_id === col.id) return;
    moveMut.mutate({ id: task.id, column_id: col.id });
  }

  function confirmDeleteTask(task: TaskOut) {
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
    deleteMut.mutate(task.id);
  }

  function handleAddColumn(e: React.FormEvent) {
    e.preventDefault();
    const name = newColumnName.trim();
    if (!name) return;
    const slug = makeColumnSlug(newColumnSlug.trim() || name);
    const sort_order =
      sortedCols.length > 0 ? Math.max(...sortedCols.map((c) => c.sort_order)) + 1 : 0;
    addColumnMut.mutate({ name, slug, sort_order, is_done_column: newColumnIsDone });
  }

  function openColumnEdit(col: KanbanColumnOut) {
    setColumnEdit(col);
    setEditColumnName(col.name);
    setEditColumnIsDone(col.is_done_column);
  }

  function handleSaveColumnEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!columnEdit) return;
    const name = editColumnName.trim();
    if (!name) return;
    updateColumnMut.mutate({
      columnId: columnEdit.id,
      body: { name, is_done_column: editColumnIsDone },
    });
  }

  function confirmDeleteColumn(col: KanbanColumnOut) {
    if (col.is_system_column) return;
    const n = (tasksByColumn.get(col.id) ?? []).length;
    if (n > 0) {
      toastError("Сначала перенесите или удалите все задачи из колонки");
      return;
    }
    if (!window.confirm(`Удалить колонку «${col.name}»? Это нельзя отменить.`)) return;
    deleteColumnMut.mutate(col.id);
  }

  function resolveColumnIdFromOver(overId: string): string | undefined {
    if (overId.startsWith(DROP_COL_PREFIX)) return overId.slice(DROP_COL_PREFIX.length);
    if (overId.startsWith(SORT_COL_PREFIX)) return overId.slice(SORT_COL_PREFIX.length);
    const overTask = tasks.find((t) => t.id === overId);
    return overTask?.column_id;
  }

  function handleDragStart(e: DragStartEvent) {
    const aid = String(e.active.id);
    if (aid.startsWith(SORT_COL_PREFIX)) {
      const cid = aid.slice(SORT_COL_PREFIX.length);
      setActiveDragColumn(sortedCols.find((c) => c.id === cid) ?? null);
      setActiveDragTask(null);
      return;
    }
    setActiveDragColumn(null);
    const t = tasks.find((x) => x.id === aid);
    setActiveDragTask(t ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragTask(null);
    setActiveDragColumn(null);
    const { active, over } = e;
    if (!over || !user) return;
    const aid = String(active.id);
    const oid = String(over.id);

    if (aid.startsWith(SORT_COL_PREFIX)) {
      if (!canManageCols || !board) return;
      if (!oid.startsWith(SORT_COL_PREFIX)) return;
      const activeCid = aid.slice(SORT_COL_PREFIX.length);
      const overCid = oid.slice(SORT_COL_PREFIX.length);
      if (activeCid === overCid) return;
      const oldIndex = sortedCols.findIndex((c) => c.id === activeCid);
      const newIndex = sortedCols.findIndex((c) => c.id === overCid);
      if (oldIndex < 0 || newIndex < 0) return;
      const newOrder = arrayMove(sortedCols, oldIndex, newIndex);
      reorderColsMut.mutate(newOrder);
      return;
    }

    const taskId = aid;
    const overId = oid;
    if (taskId === overId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !canMoveTask(user, task)) return;

    const targetColId = resolveColumnIdFromOver(overId);
    if (!targetColId) return;
    if (task.column_id === targetColId) return;
    moveMut.mutate({ id: task.id, column_id: targetColId });
  }

  function handleDragCancel() {
    setActiveDragTask(null);
    setActiveDragColumn(null);
  }

  function openTagCreateModal() {
    setEditingTagId(null);
    setTagName("");
    setTagColor("#38bdf8");
    setTagModalOpen(true);
  }

  function openTagEditModal(tag: { id: string; name: string; color: string }) {
    setEditingTagId(tag.id);
    setTagName(tag.name);
    setTagColor(tag.color);
    setTagModalOpen(true);
  }

  function syncTagInTasks(updatedTag: TaskTagView) {
    qc.setQueriesData<TaskOut[]>({ queryKey: tasksQueryKey }, (old) =>
      old?.map((task) => ({
        ...task,
        tags: task.tags.map((tag) => (tag.id === updatedTag.id ? updatedTag : tag)),
      })) ?? old,
    );
  }

  function removeTagFromTasks(tagId: string) {
    qc.setQueriesData<TaskOut[]>({ queryKey: tasksQueryKey }, (old) =>
      old?.map((task) => ({
        ...task,
        tags: task.tags.filter((tag) => tag.id !== tagId),
      })) ?? old,
    );
  }

  async function submitTagModal(e: React.FormEvent) {
    e.preventDefault();
    const name = tagName.trim();
    if (!name) return;
    try {
      if (editingTagId) {
        const updated = await updateTaskTag(editingTagId, { name, color: tagColor });
        qc.setQueryData<{ id: string; name: string; color: string }[]>(["task-tags"], (old) =>
          old ? old.map((t) => (t.id === updated.id ? updated : t)) : [updated],
        );
        syncTagInTasks({ id: updated.id, name: updated.name, color: updated.color });
        toastSuccess("Тег обновлён");
      } else {
        const created = await createTaskTag({ name, color: tagColor });
        qc.setQueryData<{ id: string; name: string; color: string }[]>(["task-tags"], (old) => {
          if (!old) return [created];
          if (old.some((t) => t.id === created.id)) return old;
          return [...old, created];
        });
        toastSuccess("Тег создан");
      }
      void qc.invalidateQueries({ queryKey: ["task-tags"], refetchType: "none" });
      setTagModalOpen(false);
      setTagName("");
      setTagColor("#38bdf8");
      setEditingTagId(null);
    } catch (e2) {
      toastApiError(e2, editingTagId ? "Не удалось обновить тег" : "Не удалось создать тег");
    }
  }

  async function removeTag(tagId: string, tagNameValue: string) {
    if (!window.confirm(`Удалить тег «${tagNameValue}»?`)) return;
    try {
      await deleteTaskTag(tagId);
      qc.setQueryData<{ id: string; name: string; color: string }[]>(["task-tags"], (old) =>
        old ? old.filter((t) => t.id !== tagId) : old,
      );
      removeTagFromTasks(tagId);
      void qc.invalidateQueries({ queryKey: ["task-tags"], refetchType: "none" });
      void qc.invalidateQueries({ queryKey: tasksQueryKey, refetchType: "none" });
      setTagIds((prev) => prev.filter((x) => x !== tagId));
      setEditTagIds((prev) => prev.filter((x) => x !== tagId));
      toastSuccess("Тег удалён");
    } catch (e) {
      toastApiError(e, "Не удалось удалить тег");
    }
  }

  const drawerCanEdit = user && drawerTask ? canUpdateTask(user, drawerTask) : false;
  const drawerCanDelete = !!(user && drawerTask && canDeleteTask(user));
  const displayError = formError ?? loadError;

  return (
    <AppShell title="Задачи" subtitle="Канбан по колонкам доски по умолчанию" wide>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {(canViewAllSystems || boardSystems.length > 1) && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-600 dark:text-slate-400">Система</span>
            <select
              value={filterSystem}
              onChange={(e) => setFilterSystem(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            >
              <option value="">Все</option>
              {boardSystems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!canViewAllSystems && boardSystems.length === 1 && (
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Система: {boardSystems[0].name}
          </span>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showOverdueOnly}
            onChange={(e) => setShowOverdueOnly(e.target.checked)}
            className="rounded border-slate-300"
          />
          Показывать только просроченные
        </label>
        {canCreate && (canViewAllSystems || boardSystems.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setAssigneeIds([]);
              setModalOpen(true);
            }}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600"
          >
            + Задача
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            onClick={openTagCreateModal}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Tags className="h-4 w-4" />
            + Тег
          </button>
        )}
        {canManageCols && board && (
          <button
            type="button"
            onClick={() => {
              setNewColumnIsDone(false);
              setColumnModalOpen(true);
            }}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            + Колонка
          </button>
        )}
      </div>
      {(tagsQuery.data ?? []).length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Фильтр по тегам</span>
            <button
              type="button"
              onClick={() => setTagFilterExpanded((v) => !v)}
              className="text-xs font-medium text-slate-600 hover:underline dark:text-slate-300"
            >
              {tagFilterExpanded ? "Свернуть" : "Развернуть"}
            </button>
            {filterTagIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setFilterTagIds([])}
                className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                Сбросить
              </button>
            ) : null}
          </div>
          {tagFilterExpanded && (
            <>
              <div className="flex flex-wrap gap-2">
                {(tagsQuery.data ?? []).map((tag) => {
                  const active = filterTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        setFilterTagIds((prev) =>
                          prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                        )
                      }
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        active
                          ? "border-transparent ring-2 ring-sky-400/80 ring-offset-1 dark:ring-offset-slate-900"
                          : "border-slate-200 opacity-85 dark:border-slate-600"
                      }`}
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                    >
                      {active ? "✓ " : ""}#{tag.name}
                    </button>
                  );
                })}
              </div>
              {filterTagIds.length > 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Показаны задачи, у которых есть хотя бы один из выбранных тегов.
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Выберите один или несколько тегов, чтобы оставить на доске только такие задачи.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {displayError && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {displayError}
        </p>
      )}
      {loading && <p className="text-slate-500">Загрузка…</p>}

      {!loading && sortedCols.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={sortedCols.map((c) => sortIdForColumn(c.id))}
            strategy={horizontalListSortingStrategy}
          >
            <div className="-mx-1 flex gap-4 overflow-x-auto pb-2 px-1">
              {sortedCols.map((col) => {
                const colTasks = tasksByColumn.get(col.id) ?? [];
                const colCount = colTasks.length;
                return (
                  <SortableColumnShell key={col.id} column={col} canReorder={!!canManageCols}>
                    {(dragHandle) => (
                      <>
                        <div className="mb-3 flex shrink-0 items-start justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-700">
                          <div className="flex min-w-0 flex-1 items-start gap-1">
                            {dragHandle}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                  {col.name}
                                </h3>
                      {col.is_done_column ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                          выполнено
                        </span>
                      ) : null}
                      <span
                        className="inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200/90 px-2 text-xs font-bold tabular-nums text-slate-700 shadow-inner ring-1 ring-slate-200/80 dark:from-slate-700 dark:to-slate-800 dark:text-slate-100 dark:ring-slate-600/80"
                        title="Задач в колонке (с учётом фильтра по системе)"
                      >
                        {colCount}
                      </span>
                              </div>
                            </div>
                          </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {canManageCols ? (
                      <button
                        type="button"
                        disabled={updateColumnMut.isPending || reorderColsMut.isPending}
                        title="Параметры колонки"
                        onClick={() => openColumnEdit(col)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label="Изменить колонку"
                      >
                        <Pencil className="h-4 w-4" strokeWidth={2} />
                      </button>
                    ) : null}
                    {canManageCols && !col.is_system_column ? (
                      <button
                        type="button"
                        disabled={deleteColumnMut.isPending || colCount > 0}
                        title={
                          colCount > 0
                            ? "Сначала перенесите или удалите все задачи"
                            : "Удалить колонку"
                        }
                        onClick={() => confirmDeleteColumn(col)}
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-red-950/40 dark:hover:text-red-400"
                        aria-label="Удалить колонку"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                </div>
                <ColumnDropArea columnId={col.id}>
                  {colTasks.map((task) => (
                    <DraggableTaskCard
                      key={task.id}
                      task={task}
                      isOverdue={overdueById.has(task.id)}
                      canDrag={!!user && canMoveTask(user, task)}
                      onOpen={() => void openDrawer(task)}
                      canDelete={!!user && canDeleteTask(user)}
                      onDelete={() => confirmDeleteTask(task)}
                      moveButtons={
                        user && canMoveTask(user, task) ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {sortedCols
                              .filter((c) => c.id !== task.column_id)
                              .map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => moveTask(task, c)}
                                  className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                                >
                                  → {c.name}
                                </button>
                              ))}
                          </div>
                        ) : null
                      }
                    />
                  ))}
                </ColumnDropArea>
                      </>
                    )}
                  </SortableColumnShell>
                );
              })}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeDragTask ? (
              <div className="pointer-events-none w-64 rounded-xl border border-sky-200 bg-white p-3 text-sm shadow-xl dark:border-sky-800 dark:bg-slate-800">
                <p className="font-medium text-slate-900 dark:text-white">{activeDragTask.title}</p>
                {activeDragTask.system && (
                  <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">{activeDragTask.system.name}</p>
                )}
              </div>
            ) : activeDragColumn ? (
              <div className="pointer-events-none flex w-72 min-h-[120px] flex-col rounded-2xl border border-violet-200 bg-white/95 p-3 text-sm shadow-xl dark:border-violet-800 dark:bg-slate-800">
                <p className="font-semibold text-slate-900 dark:text-white">{activeDragColumn.name}</p>
                <p className="mt-2 text-xs text-slate-500">Перемещение колонки</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!loading && !sortedCols.length && (
        <p className="text-slate-500">Нет колонок на доске. Проверьте миграции и сид.</p>
      )}

      {drawerTaskId && drawerTask && user && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm">
          <button type="button" className="h-full flex-1 cursor-default" aria-label="Закрыть" onClick={closeDrawer} />
          <div className="glass flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-white/40 shadow-2xl dark:border-slate-700">
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/90">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Задача</p>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Карточка</h2>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 px-5 py-4">
              {drawerLoading && <p className="text-sm text-slate-500">Обновление…</p>}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Заголовок</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  disabled={!drawerCanEdit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Описание</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  disabled={!drawerCanEdit}
                  rows={5}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Приоритет</label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as TaskOut["priority"])}
                    disabled={!drawerCanEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    {(Object.keys(PRIORITY_LABEL) as TaskOut["priority"][]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Срок</label>
                  <input
                    type="datetime-local"
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    disabled={!drawerCanEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Система</label>
                <select
                  value={editSystemId}
                  onChange={(e) => setEditSystemId(e.target.value)}
                  disabled={!drawerCanEdit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  {boardSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Колонка</label>
                <select
                  value={editColumnId}
                  onChange={(e) => setEditColumnId(e.target.value)}
                  disabled={!drawerCanEdit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  {sortedCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {assigneeChoices.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Исполнители</label>
                  <MultiAssigneePicker
                    value={editAssigneeIds}
                    onChange={setEditAssigneeIds}
                    candidates={assigneeChoices}
                    disabled={!drawerCanEdit}
                    selfId={user?.id ?? null}
                    selfDisplayName={user?.full_name ?? "я"}
                  />
                </div>
              )}
              {(tagsQuery.data ?? []).length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Теги</label>
                  <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-600 dark:bg-slate-800">
                    <div className="flex flex-wrap gap-2">
                    {(tagsQuery.data ?? []).map((tag) => {
                      const active = editTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          disabled={!drawerCanEdit}
                          onClick={() =>
                            setEditTagIds((prev) =>
                              prev.includes(tag.id)
                                ? prev.filter((id) => id !== tag.id)
                                : [...prev, tag.id],
                            )
                          }
                          className={`rounded-full border px-2 py-1 text-xs transition ${
                            active
                              ? "border-transparent ring-2 ring-offset-1 dark:ring-offset-slate-900"
                              : "border-slate-200 opacity-80 dark:border-slate-600"
                          }`}
                          style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                        >
                          {active ? "✓ " : ""}#{tag.name}
                        </button>
                      );
                    })}
                    </div>
                    {drawerCanEdit && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={openTagCreateModal}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          + Новый тег
                        </button>
                        {!!editTagIds.length && (
                          <button
                            type="button"
                            onClick={() => setEditTagIds([])}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            Очистить
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                <p>
                  <span className="font-medium text-slate-700 dark:text-slate-300">Статус колонки: </span>
                  {drawerTask.column?.name ?? "—"}
                </p>
                <p className="mt-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Создал: </span>
                  {drawerTask.creator?.full_name ?? "—"}
                </p>
                <p className="mt-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Создано: </span>
                  {formatDt(drawerTask.created_at)}
                </p>
                <p className="mt-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Обновлено: </span>
                  {formatDt(drawerTask.updated_at)}
                </p>
              </div>
              {drawerCanEdit && (
                <div className="flex justify-end gap-2 pb-2 pt-2">
                  <button
                    type="button"
                    onClick={closeDrawer}
                    className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    disabled={saveMut.isPending}
                    onClick={() => saveDrawer()}
                    className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                  >
                    {saveMut.isPending ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              )}
              {drawerCanDelete && (
                <div className="border-t border-slate-100 pb-6 pt-4 dark:border-slate-700">
                  <button
                    type="button"
                    disabled={deleteMut.isPending}
                    onClick={() => drawerTask && confirmDeleteTask(drawerTask)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {deleteMut.isPending ? "Удаление…" : "Удалить задачу"}
                  </button>
                </div>
              )}
              {!drawerCanEdit && !drawerCanDelete && (
                <p className="pb-6 text-sm text-slate-500">Нет прав на редактирование этой задачи.</p>
              )}
              {!drawerCanEdit && drawerCanDelete && (
                <p className="pb-2 text-sm text-slate-500">Редактирование недоступно, удаление — по кнопке ниже.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {modalOpen && canCreate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Новая задача</h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm">Заголовок</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              {(canViewAllSystems || boardSystems.length > 1) && (
                <div>
                  <label className="mb-1 block text-sm">Система</label>
                  <select
                    required
                    value={systemId}
                    onChange={(e) => setSystemId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">—</option>
                    {boardSystems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!canViewAllSystems && boardSystems.length === 1 && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Система: <span className="font-medium text-slate-800 dark:text-slate-200">{boardSystems[0].name}</span>
                </p>
              )}
              <div>
                <label className="mb-1 block text-sm">Колонка</label>
                <select
                  required
                  value={columnId}
                  onChange={(e) => setColumnId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                >
                  {sortedCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {assigneeChoices.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm">Исполнители</label>
                  <MultiAssigneePicker
                    value={assigneeIds}
                    onChange={setAssigneeIds}
                    candidates={assigneeChoices}
                    selfId={user?.id ?? null}
                    selfDisplayName={user?.full_name ?? "я"}
                  />
                </div>
              )}
              {(tagsQuery.data ?? []).length > 0 && (
                <div>
                  <label className="mb-1 block text-sm">Теги</label>
                  <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-600 dark:bg-slate-800">
                    <div className="flex flex-wrap gap-2">
                      {(tagsQuery.data ?? []).map((tag) => {
                        const active = tagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() =>
                              setTagIds((prev) =>
                                prev.includes(tag.id)
                                  ? prev.filter((id) => id !== tag.id)
                                  : [...prev, tag.id],
                              )
                            }
                            className={`rounded-full border px-2 py-1 text-xs transition ${
                              active
                                ? "border-transparent ring-2 ring-offset-1 dark:ring-offset-slate-900"
                                : "border-slate-200 opacity-80 dark:border-slate-600"
                            }`}
                            style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                          >
                            {active ? "✓ " : ""}#{tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalOpen(false);
                    setTagIds([]);
                    setAssigneeIds([]);
                  }}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {createMut.isPending ? "Создание…" : "Создать"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tagModalOpen && canCreate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
              {editingTagId ? "Редактировать тег" : "Новый тег"}
            </h2>
            <form onSubmit={submitTagModal} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm">Название</label>
                <input
                  required
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm">Цвет</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={tagColor}
                    onChange={(e) => setTagColor(e.target.value)}
                    className="h-10 w-12 rounded border border-slate-200 bg-white p-1 dark:border-slate-600 dark:bg-slate-800"
                  />
                  <input
                    value={tagColor}
                    onChange={(e) => setTagColor(e.target.value)}
                    placeholder="#38bdf8"
                    pattern="^#[0-9a-fA-F]{6}$"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setTagModalOpen(false);
                    setEditingTagId(null);
                  }}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
                >
                  {editingTagId ? "Сохранить" : "Создать"}
                </button>
              </div>
            </form>
            {(tagsQuery.data ?? []).length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="mb-2 text-xs font-medium text-slate-500">Существующие теги</p>
                <div className="flex max-h-40 flex-wrap gap-2 overflow-auto pr-1">
                  {(tagsQuery.data ?? []).map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                      style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                    >
                      #{tag.name}
                      <button
                        type="button"
                        onClick={() => openTagEditModal(tag)}
                        className="rounded px-1 hover:bg-black/10"
                        title="Редактировать тег"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeTag(tag.id, tag.name)}
                        className="rounded px-1 hover:bg-black/10"
                        title="Удалить тег"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {columnModalOpen && canManageCols && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Новая колонка</h2>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              Доступно при праве «управление колонками доски» (например, роль «Руководитель направления»).
            </p>
            <form onSubmit={handleAddColumn} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm">Название</label>
                <input
                  required
                  autoFocus
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  placeholder="Например, На проверке"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm">Код (латиница, необязательно)</label>
                <input
                  value={newColumnSlug}
                  onChange={(e) => setNewColumnSlug(e.target.value)}
                  placeholder="Если пусто — из названия или col_…"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={newColumnIsDone}
                  onChange={(e) => setNewColumnIsDone(e.target.checked)}
                  className="mt-1 rounded border-slate-300"
                />
                <span>
                  Считать эту колонку «выполнено» для отчётов на главной. На доске может быть только одна такая
                  колонка — у остальных флаг снимется.
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setColumnModalOpen(false);
                    setNewColumnName("");
                    setNewColumnSlug("");
                    setNewColumnIsDone(false);
                  }}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={addColumnMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {addColumnMut.isPending ? "Создание…" : "Добавить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {columnEdit && canManageCols && board && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="glass w-full max-w-md rounded-2xl p-6 shadow-soft-lg">
            <h2 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">Колонка</h2>
            <p className="mb-4 font-mono text-xs text-slate-500">{columnEdit.slug}</p>
            <form onSubmit={handleSaveColumnEdit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm">Название</label>
                <input
                  required
                  value={editColumnName}
                  onChange={(e) => setEditColumnName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={editColumnIsDone}
                  onChange={(e) => setEditColumnIsDone(e.target.checked)}
                  className="mt-1 rounded border-slate-300"
                />
                <span>
                  Колонка «выполнено» для отчётов (задачи здесь не считаются активными на главной). Только одна
                  колонка на доске.
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setColumnEdit(null)}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={updateColumnMut.isPending}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {updateColumnMut.isPending ? "Сохранение…" : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
