import { useDraggable } from "@dnd-kit/core";
import { Check, CheckSquare, MessageSquare, Paperclip, Trash2 } from "lucide-react";

import type { TaskOut } from "../../api/tasks";
import { formatAssigneesLabel } from "../../lib/taskAssignees";
import { formatTaskDueShort } from "../../lib/taskBoard";
import { taskDueStatus } from "../../lib/taskAnalyticsFilters";

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

export function DraggableTaskCard({
  task,
  canDrag,
  onOpen,
  moveButtons,
  canDelete,
  onDelete,
  isOverdue,
  isDone,
}: {
  task: TaskOut;
  canDrag: boolean;
  onOpen: () => void;
  moveButtons?: React.ReactNode;
  canDelete?: boolean;
  onDelete?: () => void;
  isOverdue?: boolean;
  isDone?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canDrag,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
  };
  const assigneesLine = formatAssigneesLabel(task);
  const dueLabel = formatTaskDueShort(task.due_at);
  const startedLabel = formatTaskDueShort(task.started_at ?? null);
  const checklistItems = task.checklist ?? [];
  const checklistTotal = checklistItems.length;
  const checklistDone = checklistItems.filter((item) => item.done).length;
  const commentsCount = task.comments_count ?? 0;
  const attachmentsCount = (task.attachments ?? []).length;
  const isDueSoon = !isDone && !isOverdue && taskDueStatus(task) === "due_soon";
  const cardTone = isDone
    ? "border-emerald-200/90 bg-emerald-50/80 hover:border-emerald-300 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:hover:border-emerald-700"
    : isOverdue
      ? "border-red-200 bg-red-50/70 hover:border-red-300 dark:border-red-900/50 dark:bg-red-950/30 dark:hover:border-red-700"
      : isDueSoon
        ? "border-amber-300 bg-amber-50/80 hover:border-amber-400 dark:border-amber-800/60 dark:bg-amber-950/35 dark:hover:border-amber-600"
        : "border-slate-100 bg-white hover:border-sky-200 hover:shadow-md dark:border-slate-600 dark:bg-slate-800/80 dark:hover:border-sky-700";
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "z-10 opacity-90" : ""}>
      <div className={`relative flex gap-1 rounded-xl border p-2 text-sm shadow-sm transition ${cardTone}`}>
        {isDone && (
          <span
            className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm ring-2 ring-white dark:ring-slate-900"
            title="Выполнено"
            aria-label="Выполнено"
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
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
            <p
              className={`font-medium ${
                isDone
                  ? "text-slate-600 line-through decoration-emerald-400/80 dark:text-slate-300 dark:decoration-emerald-600/80"
                  : "text-slate-900 dark:text-white"
              }`}
            >
              {task.title}
            </p>
            {task.system && (
              <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">{task.system.name}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {isDone && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                  Выполнено
                </span>
              )}
              {isOverdue && !isDone && (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  Просрочено
                </span>
              )}
              {isDueSoon && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  Скоро срок
                </span>
              )}
              {startedLabel && (
                <span className="text-slate-500 dark:text-slate-400" title="Дата старта">
                  с {startedLabel}
                </span>
              )}
              {dueLabel && (
                <span
                  className={
                    isOverdue && !isDone
                      ? "font-medium text-red-600 dark:text-red-300"
                      : isDueSoon
                        ? "font-medium text-amber-700 dark:text-amber-300"
                        : "text-slate-500 dark:text-slate-400"
                  }
                >
                  до {dueLabel}
                </span>
              )}
              {task.archived_at && (
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                  Архив
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
            {(checklistTotal > 0 || commentsCount > 0 || attachmentsCount > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {checklistTotal > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 ${
                      checklistDone === checklistTotal
                        ? "font-medium text-emerald-700 dark:text-emerald-300"
                        : ""
                    }`}
                    title={`Чеклист: ${checklistDone} из ${checklistTotal}`}
                  >
                    <CheckSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    <span className="tabular-nums">
                      {checklistDone}/{checklistTotal}
                    </span>
                  </span>
                )}
                {commentsCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Комментарии: ${commentsCount}`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    <span className="tabular-nums">{commentsCount}</span>
                  </span>
                )}
                {attachmentsCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Вложения: ${attachmentsCount}`}
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                    <span className="tabular-nums">{attachmentsCount}</span>
                  </span>
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
