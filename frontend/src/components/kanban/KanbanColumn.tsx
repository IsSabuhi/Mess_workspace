import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import type { KanbanColumnOut } from "../../api/boards";
import { dropIdForColumn, sortIdForColumn } from "../../lib/taskBoard";

export function ColumnDropArea({ columnId, children }: { columnId: string; children: React.ReactNode }) {
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

export function SortableColumnShell({
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
      className={`flex min-h-[calc(100vh-11rem)] min-w-[17rem] flex-1 basis-0 flex-col rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/50 ${
        isDragging ? "shadow-lg ring-2 ring-sky-400/40 dark:ring-sky-600/40" : ""
      }`}
    >
      {children(dragHandle)}
    </div>
  );
}
