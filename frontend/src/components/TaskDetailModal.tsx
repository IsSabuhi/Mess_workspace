import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Clock, History, MessageSquare, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import type { KanbanColumnOut } from "../api/boards";
import type { ChecklistItem, TaskAttachmentOut, TaskCommentOut, TaskOut } from "../api/tasks";
import { listTaskHistory } from "../api/tasks";
import { auditActionLabel, formatTaskHistorySummary } from "../lib/auditFormat";
import { useModalLayer } from "../lib/useModalLayer";
import { MultiAssigneePicker } from "./MultiAssigneePicker";

const PRIORITY_LABEL: Record<TaskOut["priority"], string> = {
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

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function newChecklistId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</label>;
}

type MentionUser = { id: string; email: string; full_name: string };
type TagOption = { id: string; name: string; color: string };
type SystemOption = { id: string; name: string };

export type TaskDetailModalProps = {
  open: boolean;
  task: TaskOut;
  loading?: boolean;
  onClose: () => void;

  editTitle: string;
  setEditTitle: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editPriority: TaskOut["priority"];
  setEditPriority: (v: TaskOut["priority"]) => void;
  editDue: string;
  setEditDue: (v: string) => void;
  editSystemId: string;
  setEditSystemId: (v: string) => void;
  editColumnId: string;
  setEditColumnId: (v: string) => void;
  editAssigneeIds: string[];
  setEditAssigneeIds: (v: string[]) => void;
  editTagIds: string[];
  setEditTagIds: (value: string[] | ((prev: string[]) => string[])) => void;
  editEstimateHours: string;
  setEditEstimateHours: (v: string) => void;
  editChecklist: ChecklistItem[];
  setEditChecklist: (value: ChecklistItem[] | ((prev: ChecklistItem[]) => ChecklistItem[])) => void;

  canEditTitle: boolean;
  canEditDescription: boolean;
  canFullyEdit: boolean;
  canChangeColumn: boolean;
  canSave: boolean;
  canDelete: boolean;
  canComment: boolean;
  canUploadAttachment: boolean;
  canDeleteAttachment: boolean;

  columns: KanbanColumnOut[];
  systems: SystemOption[];
  assigneeChoices: { id: string; full_name: string }[];
  tags: TagOption[];
  selfId: string | null;
  selfDisplayName: string;

  attachments: TaskAttachmentOut[];
  uploadPending: boolean;
  onUploadAttachment: (file: File) => void;
  onDeleteAttachment: (id: string) => void;

  comments: TaskCommentOut[];
  commentsLoading: boolean;
  commentBody: string;
  setCommentBody: (v: string) => void;
  editingCommentId: string | null;
  editingCommentBody: string;
  setEditingCommentBody: (v: string) => void;
  newCommentMentions: MentionUser[];
  editCommentMentions: MentionUser[];
  onInsertMention: (user: MentionUser, target: "new" | "edit") => void;
  onSubmitComment: () => void;
  onBeginEditComment: (c: TaskCommentOut) => void;
  onCancelEditComment: () => void;
  onSaveEditComment: () => void;
  onRemoveComment: (c: TaskCommentOut) => void;
  addCommentPending: boolean;
  editCommentPending: boolean;

  onSave: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCreateTag: () => void;
  savePending: boolean;
  archivePending: boolean;
  deletePending: boolean;
  closeOnEscape?: boolean;
};

export function TaskDetailModal({
  open,
  task,
  loading,
  onClose,
  editTitle,
  setEditTitle,
  editDescription,
  setEditDescription,
  editPriority,
  setEditPriority,
  editDue,
  setEditDue,
  editSystemId,
  setEditSystemId,
  editColumnId,
  setEditColumnId,
  editAssigneeIds,
  setEditAssigneeIds,
  editTagIds,
  setEditTagIds,
  editEstimateHours,
  setEditEstimateHours,
  editChecklist,
  setEditChecklist,
  canEditTitle,
  canEditDescription,
  canFullyEdit,
  canChangeColumn,
  canSave,
  canDelete,
  canComment,
  canUploadAttachment,
  canDeleteAttachment,
  columns,
  systems,
  assigneeChoices,
  tags,
  selfId,
  selfDisplayName,
  attachments,
  uploadPending,
  onUploadAttachment,
  onDeleteAttachment,
  comments,
  commentsLoading,
  commentBody,
  setCommentBody,
  editingCommentId,
  editingCommentBody,
  setEditingCommentBody,
  newCommentMentions,
  editCommentMentions,
  onInsertMention,
  onSubmitComment,
  onBeginEditComment,
  onCancelEditComment,
  onSaveEditComment,
  onRemoveComment,
  addCommentPending,
  editCommentPending,
  onSave,
  onArchive,
  onDelete,
  onCreateTag,
  savePending,
  archivePending,
  deletePending,
  closeOnEscape = true,
}: TaskDetailModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const { backdropProps, stopPanelPointer } = useModalLayer(open, onClose, {
    closeOnBackdrop: !savePending,
    closeOnEscape: closeOnEscape && !savePending,
  });

  useEffect(() => {
    if (open) setActivityTab("comments");
  }, [open, task.id]);

  const historyQuery = useQuery({
    queryKey: ["task-history", task.id],
    queryFn: () => listTaskHistory(task.id),
    enabled: open && activityTab === "history",
    staleTime: 15_000,
  });

  if (!open) return null;

  const isOverdue =
    !!task.due_at &&
    !task.archived_at &&
    !(task.column?.is_done_column) &&
    new Date(task.due_at).getTime() < Date.now();

  const checklistDone = editChecklist.filter((x) => x.done).length;
  const canToggleChecklist = canFullyEdit || canComment;
  const historyEvents = historyQuery.data ?? [];

  function handleCommentKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmitComment();
    }
  }

  function handleSaveClick(e?: FormEvent) {
    e?.preventDefault();
    onSave();
  }

  function addChecklistItem() {
    const text = checklistDraft.trim();
    if (!text || !canFullyEdit) return;
    setEditChecklist((prev) => [...prev, { id: newChecklistId(), text, done: false }]);
    setChecklistDraft("");
  }

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/55 p-3 sm:p-6 2xl:p-10 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={stopPanelPointer}
        className="flex max-h-[min(92vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl xl:max-h-[min(90vh,64rem)] xl:max-w-6xl 2xl:max-h-[min(92vh,76rem)] 2xl:max-w-7xl dark:border-slate-600/60 dark:bg-slate-900"
      >
        {/* Header — Linear-style: meta chips + title, без тяжёлых табов */}
        <div className="shrink-0 border-b border-slate-200/70 px-5 pb-4 pt-4 dark:border-slate-700/70 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-md border border-slate-200/90 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {task.column?.name ?? "Без колонки"}
                </span>
                <span
                  className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_BADGE_CLASS[editPriority]}`}
                >
                  {PRIORITY_LABEL[editPriority]}
                </span>
                {task.archived_at && (
                  <span className="inline-flex rounded-md bg-slate-200/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    В архиве
                  </span>
                )}
                {isOverdue && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    <Clock className="h-3 w-3" />
                    Просрочено
                  </span>
                )}
                {loading && <span className="text-xs text-slate-400">Обновление…</span>}
              </div>
              <input
                id="task-detail-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={!canEditTitle}
                placeholder="Название задачи"
                className="mt-2.5 w-full border-0 bg-transparent p-0 text-[1.35rem] font-semibold leading-snug tracking-tight text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-70 dark:text-white"
              />
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {task.creator?.full_name ? (
                  <>
                    <span className="text-slate-600 dark:text-slate-300">{task.creator.full_name}</span>
                    <span> создал</span>
                  </>
                ) : (
                  "Задача"
                )}
                {task.system?.name ? ` · ${task.system.name}` : ""}
                <span className="text-slate-400"> · {formatDt(task.created_at)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(15rem,0.75fr)]">
            {/* Main */}
            <div className="space-y-6 border-b border-slate-200/70 px-5 py-5 dark:border-slate-700/70 sm:px-6 lg:border-b-0 lg:border-r">
              <div>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  disabled={!canEditDescription}
                  rows={8}
                  placeholder="Добавить описание…"
                  className="min-h-[10rem] w-full resize-y rounded-xl border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0 disabled:opacity-70 xl:min-h-[14rem] 2xl:min-h-[18rem] dark:text-slate-100"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Чеклист</p>
                  {editChecklist.length > 0 && (
                    <span className="text-xs tabular-nums text-slate-400">
                      {checklistDone}/{editChecklist.length}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {editChecklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!canToggleChecklist}
                        onChange={() =>
                          setEditChecklist((prev) =>
                            prev.map((x) => (x.id === item.id ? { ...x, done: !x.done } : x)),
                          )
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600"
                      />
                      {canFullyEdit ? (
                        <input
                          value={item.text}
                          onChange={(e) =>
                            setEditChecklist((prev) =>
                              prev.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)),
                            )
                          }
                          className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none ${
                            item.done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"
                          }`}
                        />
                      ) : (
                        <p
                          className={`min-w-0 flex-1 text-sm ${
                            item.done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"
                          }`}
                        >
                          {item.text}
                        </p>
                      )}
                      {canFullyEdit && (
                        <button
                          type="button"
                          onClick={() => setEditChecklist((prev) => prev.filter((x) => x.id !== item.id))}
                          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          aria-label="Удалить пункт"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canFullyEdit && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={checklistDraft}
                      onChange={(e) => setChecklistDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addChecklistItem();
                        }
                      }}
                      placeholder="Новый пункт…"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={addChecklistItem}
                      disabled={!checklistDraft.trim()}
                      className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Добавить
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Вложения</p>
                  {attachments.length > 0 && (
                    <span className="text-xs tabular-nums text-slate-400">{attachments.length}</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        {att.filename}
                      </a>
                      <span className="shrink-0 text-[11px] text-slate-400">{formatBytes(att.size_bytes)}</span>
                      {canDeleteAttachment && (
                        <button
                          type="button"
                          onClick={() => onDeleteAttachment(att.id)}
                          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                          aria-label="Удалить файл"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {canUploadAttachment && (
                  <div className="mt-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUploadAttachment(f);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploadPending}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {uploadPending ? "Загрузка…" : "Прикрепить файл"}
                    </button>
                    <p className="mt-1 text-[11px] text-slate-400">До 20 МБ · изображения, PDF, Office, ZIP</p>
                  </div>
                )}
              </div>

              {/* Activity — как в Linear: комментарии / история внизу карточки */}
              <div className="border-t border-slate-200/70 pt-5 dark:border-slate-700/70">
                <div className="mb-4 flex items-end gap-4 border-b border-slate-200/70 dark:border-slate-700/70">
                  <button
                    type="button"
                    onClick={() => setActivityTab("comments")}
                    className={`-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium transition ${
                      activityTab === "comments"
                        ? "border-sky-500 text-slate-900 dark:text-white"
                        : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Комментарии
                    {comments.length > 0 && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {comments.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivityTab("history")}
                    className={`-mb-px inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium transition ${
                      activityTab === "history"
                        ? "border-sky-500 text-slate-900 dark:text-white"
                        : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    <History className="h-3.5 w-3.5" />
                    История
                  </button>
                </div>

                {activityTab === "comments" ? (
                  <>
                    <div className="max-h-72 space-y-3 overflow-y-auto pr-0.5">
                      {commentsLoading && <p className="text-xs text-slate-500">Загрузка…</p>}
                      {!commentsLoading && comments.length === 0 && (
                        <p className="py-6 text-center text-sm text-slate-400">Пока нет комментариев</p>
                      )}
                      {comments.map((comment) => (
                        <div key={comment.id} className="group">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs">
                              <span className="font-semibold text-slate-800 dark:text-slate-100">
                                {comment.author?.full_name ?? "Пользователь"}
                              </span>
                              <span className="text-slate-400"> · {formatDt(comment.created_at)}</span>
                            </p>
                            {(canFullyEdit || comment.author_id === selfId) && (
                              <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => onBeginEditComment(comment)}
                                  className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                                >
                                  Изменить
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRemoveComment(comment)}
                                  className="rounded-md px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                >
                                  Удалить
                                </button>
                              </div>
                            )}
                          </div>
                          {editingCommentId === comment.id ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={editingCommentBody}
                                onChange={(e) => setEditingCommentBody(e.target.value)}
                                rows={3}
                                className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                              />
                              {editCommentMentions.length > 0 && (
                                <MentionList users={editCommentMentions} onPick={(u) => onInsertMention(u, "edit")} />
                              )}
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={onCancelEditComment}
                                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] dark:border-slate-600"
                                >
                                  Отмена
                                </button>
                                <button
                                  type="button"
                                  disabled={editCommentPending || !editingCommentBody.trim()}
                                  onClick={onSaveEditComment}
                                  className="rounded-lg bg-sky-500 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-60"
                                >
                                  {editCommentPending ? "Сохранение…" : "Сохранить"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                              {comment.body}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    {canComment && (
                      <div className="mt-4 space-y-2">
                        <textarea
                          value={commentBody}
                          onChange={(e) => setCommentBody(e.target.value)}
                          onKeyDown={handleCommentKey}
                          rows={3}
                          placeholder="Оставить комментарий… @ — упоминание, Ctrl+Enter — отправить"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/25 dark:border-slate-600 dark:bg-slate-800/80 dark:focus:bg-slate-800"
                        />
                        {newCommentMentions.length > 0 && (
                          <MentionList users={newCommentMentions} onPick={(u) => onInsertMention(u, "new")} />
                        )}
                        <div className="flex justify-end">
                          <button
                            type="button"
                            disabled={addCommentPending || !commentBody.trim()}
                            onClick={onSubmitComment}
                            className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                          >
                            {addCommentPending ? "Отправка…" : "Отправить"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    {historyQuery.isPending && <p className="py-4 text-sm text-slate-500">Загрузка истории…</p>}
                    {historyQuery.isError && (
                      <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                        Не удалось загрузить историю
                      </p>
                    )}
                    {!historyQuery.isPending && !historyQuery.isError && historyEvents.length === 0 && (
                      <p className="py-6 text-center text-sm text-slate-400">Записей пока нет</p>
                    )}
                    {historyEvents.length > 0 && (
                      <ol className="relative max-h-80 space-y-0 overflow-y-auto border-l border-slate-200 pl-4 dark:border-slate-700">
                        {historyEvents.map((ev) => {
                          const summary = formatTaskHistorySummary(ev.action, ev.details_json);
                          const isMove =
                            ev.action === "task.updated" &&
                            (summary.includes("Статус:") || summary.includes("колонк"));
                          const isCreate = ev.action === "task.created";
                          return (
                            <li key={ev.id} className="relative pb-4 last:pb-1">
                              <span
                                className={`absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full ring-[3px] ring-white dark:ring-slate-900 ${
                                  isMove ? "bg-sky-500" : isCreate ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-500"
                                }`}
                              />
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                <p className="text-sm text-slate-800 dark:text-slate-100">
                                  <span className="font-medium text-slate-900 dark:text-white">
                                    {ev.actor_name?.trim() || "Система"}
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400">
                                    {" "}
                                    · {auditActionLabel(ev.action).toLowerCase()}
                                  </span>
                                </p>
                                <time className="shrink-0 text-[11px] text-slate-400" dateTime={ev.created_at}>
                                  {formatDt(ev.created_at)}
                                </time>
                              </div>
                              <p
                                className={`mt-0.5 text-sm ${
                                  isMove
                                    ? "font-medium text-sky-700 dark:text-sky-300"
                                    : "text-slate-600 dark:text-slate-300"
                                }`}
                              >
                                {summary}
                              </p>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Side meta */}
            <aside className="space-y-4 px-5 py-5 sm:px-6 lg:bg-slate-50/50 dark:lg:bg-slate-950/30">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <FieldLabel>Колонка</FieldLabel>
                  <select
                    value={editColumnId}
                    onChange={(e) => setEditColumnId(e.target.value)}
                    disabled={!canChangeColumn}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Приоритет</FieldLabel>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as TaskOut["priority"])}
                    disabled={!canFullyEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    {(Object.keys(PRIORITY_LABEL) as TaskOut["priority"][]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Срок</FieldLabel>
                  <input
                    type="datetime-local"
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    disabled={!canFullyEdit}
                    className={`w-full rounded-xl border px-3 py-2 text-sm dark:bg-slate-800 ${
                      isOverdue
                        ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"
                        : "border-slate-200 bg-white dark:border-slate-600"
                    }`}
                  />
                </div>
                <div>
                  <FieldLabel>Оценка, ч</FieldLabel>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={editEstimateHours}
                    onChange={(e) => setEditEstimateHours(e.target.value)}
                    disabled={!canFullyEdit}
                    placeholder="напр. 4"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <FieldLabel>Система</FieldLabel>
                  <select
                    value={editSystemId}
                    onChange={(e) => setEditSystemId(e.target.value)}
                    disabled={!canFullyEdit || systems.length <= 1}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    {systems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {assigneeChoices.length > 0 && (
                <div>
                  <FieldLabel>Исполнители</FieldLabel>
                  <MultiAssigneePicker
                    value={editAssigneeIds}
                    onChange={setEditAssigneeIds}
                    candidates={assigneeChoices}
                    disabled={!canFullyEdit}
                    selfId={selfId}
                    selfDisplayName={selfDisplayName}
                  />
                </div>
              )}

              {tags.length > 0 ? (
                <div>
                  <FieldLabel>Теги</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => {
                      const active = editTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          disabled={!canFullyEdit}
                          onClick={() =>
                            setEditTagIds((prev) =>
                              prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition ${
                            active
                              ? "border-transparent ring-2 ring-offset-1 dark:ring-offset-slate-900"
                              : "border-slate-200/80 opacity-75 dark:border-slate-600"
                          }`}
                          style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                        >
                          {active ? "✓ " : ""}#{tag.name}
                        </button>
                      );
                    })}
                  </div>
                  {canFullyEdit && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={onCreateTag}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        + Новый тег
                      </button>
                      {!!editTagIds.length && (
                        <button
                          type="button"
                          onClick={() => setEditTagIds([])}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Очистить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                canFullyEdit && (
                  <div>
                    <FieldLabel>Теги</FieldLabel>
                    <button
                      type="button"
                      onClick={onCreateTag}
                      className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      + Создать первый тег
                    </button>
                  </div>
                )
              )}

              <div className="space-y-1.5 pt-1 text-xs text-slate-500 dark:text-slate-400">
                <p>
                  Обновлено <span className="text-slate-600 dark:text-slate-300">{formatDt(task.updated_at)}</span>
                </p>
              </div>
            </aside>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200/80 px-5 py-3.5 dark:border-slate-700/80 sm:px-6">
          {!canSave && !canDelete && (
            <p className="text-sm text-slate-500">Нет прав на редактирование этой задачи.</p>
          )}
          {!canSave && canDelete && (
            <p className="mb-3 text-sm text-slate-500">Редактирование недоступно, удаление — справа.</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {canFullyEdit && (
                <button
                  type="button"
                  disabled={archivePending}
                  onClick={onArchive}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {task.archived_at ? (
                    <ArchiveRestore className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                  {archivePending ? "Обновление…" : task.archived_at ? "Восстановить" : "В архив"}
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  disabled={deletePending}
                  onClick={onDelete}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deletePending ? "Удаление…" : "Удалить"}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Закрыть
              </button>
              {canSave && (
                <button
                  type="button"
                  disabled={savePending}
                  onClick={() => handleSaveClick()}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  {savePending ? "Сохранение…" : "Сохранить"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MentionList({
  users,
  onPick,
}: {
  users: MentionUser[];
  onPick: (u: MentionUser) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-600 dark:bg-slate-900">
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          onClick={() => onPick(u)}
          className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          {u.full_name} · {u.email}
        </button>
      ))}
    </div>
  );
}
