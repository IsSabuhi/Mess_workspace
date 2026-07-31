import { useMemo, useState } from "react";
import { History, RotateCcw } from "lucide-react";

import type { KnowledgeArticleRevisionOut } from "../api/knowledge";
import { diffLines, htmlToPlainText } from "../lib/simpleDiff";
import { useModalLayer } from "../lib/useModalLayer";
import { ConfirmDialog } from "./ConfirmDialog";

type CurrentSnapshot = {
  title: string;
  content: string;
  status: "draft" | "published";
  parent_id: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  revisions: KnowledgeArticleRevisionOut[];
  loading?: boolean;
  current: CurrentSnapshot;
  canRestore: boolean;
  restoring?: boolean;
  onRestore: (revisionId: string) => void;
  parentTitleById?: Map<string, string>;
};

const STATUS_LABEL = { draft: "Черновик", published: "Опубликовано" } as const;

export function KnowledgeRevisionsModal({
  open,
  onClose,
  revisions,
  loading,
  current,
  canRestore,
  restoring,
  onRestore,
  parentTitleById,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { backdropProps, stopPanelPointer } = useModalLayer(open, onClose, {
    closeOnEscape: !restoring && !confirmOpen,
    closeOnBackdrop: !restoring && !confirmOpen,
  });

  const selected = useMemo(
    () => revisions.find((r) => r.id === selectedId) ?? revisions[0] ?? null,
    [revisions, selectedId],
  );

  const activeId = selected?.id ?? null;

  const changes = useMemo(() => {
    if (!selected) return null;
    const curText = htmlToPlainText(current.content);
    const revText = htmlToPlainText(selected.content);
    const titleChanged = current.title.trim() !== selected.title.trim();
    const statusChanged = current.status !== selected.status;
    const parentChanged = (current.parent_id ?? null) !== (selected.parent_id ?? null);
    const contentChanged = curText !== revText;
    return {
      titleChanged,
      statusChanged,
      parentChanged,
      contentChanged,
      curText,
      revText,
      lines: contentChanged ? diffLines(curText, revText) : [],
    };
  }, [selected, current]);

  if (!open) return null;

  return (
    <>
      <div
        {...backdropProps}
        className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      >
        <div
          className="modal-panel flex max-h-[min(90vh,52rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-soft-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kb-revisions-title"
          onClick={stopPanelPointer}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-slate-700/80">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <History className="h-4 w-4" />
              </span>
              <div>
                <h3 id="kb-revisions-title" className="text-base font-semibold text-slate-900 dark:text-white">
                  История версий
                </h3>
                <p className="text-xs text-slate-500">Выберите снимок и посмотрите, что изменилось</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ✕
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-slate-200/80 p-3 md:border-b-0 md:border-r dark:border-slate-700/80">
              {loading && <p className="px-2 py-3 text-sm text-slate-500">Загрузка…</p>}
              {!loading && revisions.length === 0 && (
                <p className="px-2 py-3 text-sm text-slate-500">Версий пока нет. Они появятся после сохранений.</p>
              )}
              <ul className="space-y-1">
                {revisions.map((rev, idx) => {
                  const active = rev.id === activeId;
                  return (
                    <li key={rev.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(rev.id)}
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                          active
                            ? "bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-800/60"
                            : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <p className={`text-sm font-medium ${active ? "text-sky-800 dark:text-sky-100" : "text-slate-800 dark:text-slate-100"}`}>
                          {new Date(rev.created_at).toLocaleString("ru-RU")}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{rev.title || "Без заголовка"}</p>
                        {idx === 0 && (
                          <span className="mt-1 inline-block rounded-full bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            последняя запись
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <div className="flex min-h-0 flex-col">
              {!selected && (
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
                  Выберите версию слева
                </div>
              )}
              {selected && changes && (
                <>
                  <div className="space-y-3 overflow-y-auto p-5">
                    <div className="flex flex-wrap gap-2">
                      {!changes.titleChanged &&
                        !changes.statusChanged &&
                        !changes.parentChanged &&
                        !changes.contentChanged && (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            Совпадает с текущей статьёй
                          </span>
                        )}
                      {changes.titleChanged && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          Заголовок изменён
                        </span>
                      )}
                      {changes.statusChanged && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          Статус изменён
                        </span>
                      )}
                      {changes.parentChanged && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                          Родитель изменён
                        </span>
                      )}
                      {changes.contentChanged && (
                        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                          Текст изменён
                        </span>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <MetaCard
                        label="Сейчас"
                        title={current.title}
                        status={STATUS_LABEL[current.status]}
                        parent={
                          current.parent_id
                            ? parentTitleById?.get(current.parent_id) ?? current.parent_id
                            : "— Корень —"
                        }
                      />
                      <MetaCard
                        label="В этой версии"
                        title={selected.title}
                        status={STATUS_LABEL[selected.status]}
                        parent={
                          selected.parent_id
                            ? parentTitleById?.get(selected.parent_id) ?? selected.parent_id
                            : "— Корень —"
                        }
                        highlight
                      />
                    </div>

                    {changes.contentChanged ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Изменения в тексте
                        </p>
                        <div className="max-h-[min(40vh,22rem)] overflow-auto rounded-xl border border-slate-200 bg-slate-50/80 font-mono text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-950/50">
                          {changes.lines.map((line, i) => (
                            <div
                              key={`${i}-${line.type}-${line.text.slice(0, 24)}`}
                              className={`whitespace-pre-wrap break-words px-3 py-0.5 ${
                                line.type === "add"
                                  ? "bg-emerald-100/80 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                                  : line.type === "del"
                                    ? "bg-red-100/80 text-red-900 dark:bg-red-950/50 dark:text-red-200"
                                    : "text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              <span className="mr-2 inline-block w-3 select-none opacity-60">
                                {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                              </span>
                              {line.text || " "}
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          <span className="text-red-600 dark:text-red-400">− удалено</span>
                          {" · "}
                          <span className="text-emerald-600 dark:text-emerald-400">+ добавлено</span>
                          {" относительно текущей статьи"}
                        </p>
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500 dark:border-slate-700">
                        Текст статьи в этой версии совпадает с текущим.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-3 dark:border-slate-700/80">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                    >
                      Закрыть
                    </button>
                    {canRestore && (
                      <button
                        type="button"
                        disabled={restoring}
                        onClick={() => setConfirmOpen(true)}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Восстановить эту версию
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => !restoring && setConfirmOpen(false)}
        onConfirm={() => {
          if (!selected) return;
          onRestore(selected.id);
          setConfirmOpen(false);
        }}
        title="Восстановить версию?"
        message={
          selected ? (
            <>
              Статья вернётся к состоянию от{" "}
              <strong className="font-semibold">{new Date(selected.created_at).toLocaleString("ru-RU")}</strong>
              {selected.title ? (
                <>
                  {" "}
                  («{selected.title}»). Текущее содержимое будет сохранено в истории как новая запись.
                </>
              ) : (
                ". Текущее содержимое будет сохранено в истории как новая запись."
              )}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Восстановить"
        variant="warning"
        pending={restoring}
        lockWhilePending
      />
    </>
  );
}

function MetaCard({
  label,
  title,
  status,
  parent,
  highlight,
}: {
  label: string;
  title: string;
  status: string;
  parent: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${
        highlight
          ? "border-sky-200 bg-sky-50/60 dark:border-sky-800/60 dark:bg-sky-950/30"
          : "border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900/40"
      }`}
    >
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-medium text-slate-900 dark:text-slate-100">{title || "—"}</p>
      <p className="mt-1 text-xs text-slate-500">Статус: {status}</p>
      <p className="mt-0.5 truncate text-xs text-slate-500" title={parent}>
        Родитель: {parent}
      </p>
    </div>
  );
}
