import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  CheckSquare,
  ImagePlus,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createNote,
  createNoteTag,
  deleteNote,
  deleteNoteAttachment,
  listNotes,
  listNoteTags,
  NOTE_COLOR_OPTIONS,
  noteSurfaceClass,
  newChecklistItem,
  restoreNote,
  trashNote,
  updateNote,
  uploadNoteAttachment,
  type ChecklistItem,
  type NoteScope,
  type PersonalNoteOut,
} from "../api/notes";
import { AppShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toastApiError, toastSuccess } from "../lib/toast";
import { useToastQueryError } from "../lib/useToastQueryError";

const SUGGESTED_TAGS = ["работа", "идеи", "звонки"] as const;

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function notePreview(n: PersonalNoteOut): string {
  const undone = n.checklist_items.filter((c) => !c.done);
  if (undone.length) {
    const t = undone[0].text.trim() || "Пункт списка";
    return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  }
  const t = n.content.replace(/\s+/g, " ").trim();
  if (!t) return "Пустая заметка";
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

function sameChecklist(a: ChecklistItem[], b: ChecklistItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => item.id === b[i].id && item.text === b[i].text && item.done === b[i].done);
}

export function NotesPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<NoteScope>("active");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterTagId, setFilterTagId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftChecklist, setDraftChecklist] = useState<ChecklistItem[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextAutosave = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const notesQuery = useQuery({
    queryKey: ["notes", scope, debouncedSearch, filterTagId],
    queryFn: () =>
      listNotes({
        scope,
        q: debouncedSearch || undefined,
        tag_id: filterTagId || undefined,
        limit: 300,
      }),
  });
  const tagsQuery = useQuery({ queryKey: ["notes", "tags"], queryFn: listNoteTags });
  useToastQueryError(notesQuery.error, "Не удалось загрузить заметки");
  useToastQueryError(tagsQuery.error, "Не удалось загрузить метки");

  const notes = notesQuery.data ?? [];
  const allTags = tagsQuery.data ?? [];
  const selected = useMemo(() => notes.find((n) => n.id === selectedId) ?? null, [notes, selectedId]);
  const inTrash = scope === "trash" || !!selected?.deleted_at;

  useEffect(() => {
    if (!notes.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !notes.some((n) => n.id === selectedId)) {
      setSelectedId(notes[0].id);
    }
  }, [notes, selectedId]);

  useEffect(() => {
    if (!selected) {
      setDraftTitle("");
      setDraftContent("");
      setDraftChecklist([]);
      setSaveState("idle");
      return;
    }
    skipNextAutosave.current = true;
    setDraftTitle(selected.title);
    setDraftContent(selected.content);
    setDraftChecklist(selected.checklist_items ?? []);
    setSaveState("idle");
  }, [selected?.id]);

  const refreshNotes = async () => {
    await qc.invalidateQueries({ queryKey: ["notes"] });
  };

  const createMut = useMutation({
    mutationFn: () => createNote({ title: "", content: "", checklist_items: [] }),
    onSuccess: async (created) => {
      setScope("active");
      setSearch("");
      setDebouncedSearch("");
      setFilterTagId("");
      setSelectedId(created.id);
      await refreshNotes();
    },
    onError: (e) => toastApiError(e, "Не удалось создать заметку"),
  });

  const patchMut = useMutation({
    mutationFn: (vars: { id: string; body: Parameters<typeof updateNote>[1] }) =>
      updateNote(vars.id, vars.body),
    onMutate: () => setSaveState("saving"),
    onSuccess: async (updated) => {
      setSaveState("saved");
      qc.setQueriesData<PersonalNoteOut[]>({ queryKey: ["notes"] }, (prev) => {
        if (!prev) return prev;
        const i = prev.findIndex((n) => n.id === updated.id);
        if (i === -1) return prev;
        const next = [...prev];
        next[i] = updated;
        return next;
      });
      await refreshNotes();
    },
    onError: (e) => {
      setSaveState("error");
      toastApiError(e, "Не удалось сохранить заметку");
    },
  });

  const trashMut = useMutation({
    mutationFn: (id: string) => trashNote(id),
    onSuccess: async () => {
      setSelectedId(null);
      toastSuccess("Заметка в корзине");
      await refreshNotes();
    },
    onError: (e) => toastApiError(e, "Не удалось переместить в корзину"),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreNote(id),
    onSuccess: async (note) => {
      setScope("active");
      setSelectedId(note.id);
      toastSuccess("Заметка восстановлена");
      await refreshNotes();
    },
    onError: (e) => toastApiError(e, "Не удалось восстановить"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteNote(id, true),
    onSuccess: async () => {
      setDeleteOpen(false);
      setSelectedId(null);
      toastSuccess("Заметка удалена навсегда");
      await refreshNotes();
    },
    onError: (e) => toastApiError(e, "Не удалось удалить"),
  });

  const createTagMut = useMutation({
    mutationFn: (name: string) => createNoteTag(name),
    onSuccess: async () => {
      setTagDraft("");
      await qc.invalidateQueries({ queryKey: ["notes", "tags"] });
    },
    onError: (e) => toastApiError(e, "Не удалось создать метку"),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => {
      if (!selected) throw new Error("no note");
      return uploadNoteAttachment(selected.id, file);
    },
    onSuccess: async () => {
      toastSuccess("Файл добавлен");
      await refreshNotes();
    },
    onError: (e) => toastApiError(e, "Не удалось загрузить файл"),
  });

  const deleteAttachmentMut = useMutation({
    mutationFn: (attachmentId: string) => {
      if (!selected) throw new Error("no note");
      return deleteNoteAttachment(selected.id, attachmentId);
    },
    onSuccess: async () => {
      await refreshNotes();
    },
    onError: (e) => toastApiError(e, "Не удалось удалить вложение"),
  });

  useEffect(() => {
    if (!selected || inTrash) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const checklistSame = sameChecklist(draftChecklist, selected.checklist_items ?? []);
    if (draftTitle === selected.title && draftContent === selected.content && checklistSame) return;

    const noteId = selected.id;
    const t = window.setTimeout(() => {
      if (selectedIdRef.current !== noteId) return;
      patchMut.mutate({
        id: noteId,
        body: {
          title: draftTitle,
          content: draftContent,
          checklist_items: draftChecklist,
        },
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [
    draftTitle,
    draftContent,
    draftChecklist,
    selected?.id,
    selected?.title,
    selected?.content,
    selected?.checklist_items,
    inTrash,
  ]);

  async function ensureTagAndToggle(tagName: string) {
    if (!selected || inTrash) return;
    let tag = allTags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
    if (!tag) {
      tag = await createTagMut.mutateAsync(tagName);
      await qc.invalidateQueries({ queryKey: ["notes", "tags"] });
    }
    const current = new Set(selected.tags.map((t) => t.id));
    if (current.has(tag.id)) current.delete(tag.id);
    else current.add(tag.id);
    patchMut.mutate({ id: selected.id, body: { tag_ids: [...current] } });
  }

  function toggleTagId(tagId: string) {
    if (!selected || inTrash) return;
    const current = new Set(selected.tags.map((t) => t.id));
    if (current.has(tagId)) current.delete(tagId);
    else current.add(tagId);
    patchMut.mutate({ id: selected.id, body: { tag_ids: [...current] } });
  }

  const saveLabel =
    saveState === "saving"
      ? "Сохранение…"
      : saveState === "saved"
        ? "Сохранено"
        : saveState === "error"
          ? "Ошибка сохранения"
          : "";

  const scopeBtn = (id: NoteScope, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setScope(id)}
      className={`rounded-[0.65rem] px-2 py-1.5 text-xs font-semibold transition ${
        scope === id
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <AppShell title="Заметки" subtitle="Личные заметки — видны только вам">
      <div
        className={`flex min-h-[min(70vh,48rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 shadow-soft dark:border-slate-700 lg:flex-row ${noteSurfaceClass(
          selected?.color,
        )}`}
      >
        <aside className="flex w-full shrink-0 flex-col border-b border-slate-200/80 bg-white/70 dark:border-slate-700 dark:bg-slate-950/40 lg:w-80 lg:border-b-0 lg:border-r xl:w-96">
          <div className="space-y-3 border-b border-slate-200/80 p-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 flex-wrap gap-0.5 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
                {scopeBtn("active", "Активные")}
                {scopeBtn("archived", "Архив")}
                {scopeBtn("trash", "Корзина")}
              </div>
              <button
                type="button"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || scope === "trash"}
                title="Новая заметка"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm hover:bg-sky-600 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterTagId("")}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    !filterTagId
                      ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  Все метки
                </button>
                {allTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFilterTagId((prev) => (prev === t.id ? "" : t.id))}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      filterTagId === t.id
                        ? "bg-amber-500 text-white"
                        : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {notesQuery.isPending && <p className="px-2 py-6 text-center text-sm text-slate-500">Загрузка…</p>}
            {!notesQuery.isPending && notes.length === 0 && (
              <div className="px-3 py-10 text-center">
                <StickyNote className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  {debouncedSearch
                    ? "Ничего не найдено"
                    : scope === "archived"
                      ? "Архив пуст"
                      : scope === "trash"
                        ? "Корзина пуста"
                        : "Пока нет заметок"}
                </p>
              </div>
            )}
            <ul className="space-y-1">
              {notes.map((n) => {
                const active = n.id === selectedId;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(n.id)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                        active
                          ? "ring-1 ring-sky-300/80 dark:ring-sky-700/70"
                          : "hover:bg-black/5 dark:hover:bg-white/5"
                      } ${noteSurfaceClass(n.color)}`}
                    >
                      <div className="flex items-start gap-2">
                        {n.is_pinned && <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {n.title.trim() || "Без названия"}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                            {notePreview(n)}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {n.reminder_at && <Bell className="h-3 w-3 text-sky-500" />}
                            {n.tags.slice(0, 2).map((t) => (
                              <span
                                key={t.id}
                                className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-white/10 dark:text-slate-300"
                              >
                                {t.name}
                              </span>
                            ))}
                            <span className="text-[11px] text-slate-400">{formatUpdatedAt(n.updated_at)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {!selected && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center text-slate-500">
              <StickyNote className="h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="text-sm">Выберите заметку или создайте новую</p>
            </div>
          )}
          {selected && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 px-4 py-2.5 dark:border-slate-700/80">
                <p className="text-xs text-slate-500">
                  {saveLabel || `Обновлено ${formatUpdatedAt(selected.updated_at)}`}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  {!inTrash && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          patchMut.mutate({ id: selected.id, body: { is_pinned: !selected.is_pinned } })
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        {selected.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                        {selected.is_pinned ? "Открепить" : "Закрепить"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patchMut.mutate(
                            { id: selected.id, body: { is_archived: !selected.is_archived } },
                            {
                              onSuccess: async () => {
                                toastSuccess(selected.is_archived ? "Из архива" : "В архиве");
                                setSelectedId(null);
                                await refreshNotes();
                              },
                            },
                          )
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        {selected.is_archived ? (
                          <ArchiveRestore className="h-4 w-4" />
                        ) : (
                          <Archive className="h-4 w-4" />
                        )}
                        {selected.is_archived ? "Из архива" : "В архив"}
                      </button>
                      <button
                        type="button"
                        onClick={() => trashMut.mutate(selected.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                        В корзину
                      </button>
                    </>
                  )}
                  {inTrash && (
                    <>
                      <button
                        type="button"
                        onClick={() => restoreMut.mutate(selected.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Восстановить
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteOpen(true)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить навсегда
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  disabled={inTrash}
                  placeholder="Заголовок"
                  className="w-full border-0 bg-transparent text-2xl font-bold tracking-tight text-slate-900 outline-none placeholder:text-slate-300 disabled:opacity-70 dark:text-white dark:placeholder:text-slate-600"
                />

                {!inTrash && (
                  <div className="flex flex-wrap items-center gap-2">
                    {NOTE_COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        title={c.label}
                        onClick={() => patchMut.mutate({ id: selected.id, body: { color: c.id } })}
                        className={`h-6 w-6 rounded-full ${c.swatch} ${
                          selected.color === c.id ? "ring-2 ring-sky-500 ring-offset-2 dark:ring-offset-slate-900" : ""
                        }`}
                      />
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-slate-400" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Чеклист</span>
                    {!inTrash && (
                      <button
                        type="button"
                        onClick={() => setDraftChecklist((prev) => [...prev, newChecklistItem()])}
                        className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                      >
                        + пункт
                      </button>
                    )}
                  </div>
                  <ul className="space-y-1.5">
                    {draftChecklist.map((item, idx) => (
                      <li key={item.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={item.done}
                          disabled={inTrash}
                          onChange={(e) =>
                            setDraftChecklist((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, done: e.target.checked } : x)),
                            )
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <input
                          value={item.text}
                          disabled={inTrash}
                          onChange={(e) =>
                            setDraftChecklist((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)),
                            )
                          }
                          placeholder="Пункт списка"
                          className={`min-w-0 flex-1 rounded-lg border border-transparent bg-white/60 px-2 py-1.5 text-sm outline-none focus:border-sky-300 dark:bg-slate-900/40 ${
                            item.done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"
                          }`}
                        />
                        {!inTrash && (
                          <button
                            type="button"
                            onClick={() => setDraftChecklist((prev) => prev.filter((_, i) => i !== idx))}
                            className="rounded-lg p-1 text-slate-400 hover:bg-black/5 hover:text-red-500"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  disabled={inTrash}
                  placeholder="Текст заметки…"
                  className="min-h-[10rem] w-full flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-300 disabled:opacity-70 dark:text-slate-100 dark:placeholder:text-slate-600"
                />

                <div className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Метки</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_TAGS.map((name) => {
                      const exists = allTags.find((t) => t.name.toLowerCase() === name);
                      const on = exists ? selected.tags.some((t) => t.id === exists.id) : false;
                      return (
                        <button
                          key={name}
                          type="button"
                          disabled={inTrash}
                          onClick={() => void ensureTagAndToggle(name)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                            on
                              ? "bg-amber-500 text-white"
                              : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                    {allTags
                      .filter((t) => !SUGGESTED_TAGS.includes(t.name as (typeof SUGGESTED_TAGS)[number]))
                      .map((t) => {
                        const on = selected.tags.some((x) => x.id === t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={inTrash}
                            onClick={() => toggleTagId(t.id)}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
                              on
                                ? "bg-amber-500 text-white"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            }`}
                          >
                            {t.name}
                          </button>
                        );
                      })}
                  </div>
                  {!inTrash && (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = tagDraft.trim();
                        if (!name) return;
                        void ensureTagAndToggle(name).then(() => setTagDraft(""));
                      }}
                    >
                      <input
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        placeholder="Новая метка…"
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900/50"
                      />
                      <button
                        type="submit"
                        className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-200 dark:text-slate-900"
                      >
                        Добавить
                      </button>
                    </form>
                  )}
                </div>

                <div className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-slate-400" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Напоминание</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      disabled={inTrash}
                      value={toLocalInputValue(selected.reminder_at)}
                      onChange={(e) => {
                        const iso = fromLocalInputValue(e.target.value);
                        if (!iso) {
                          patchMut.mutate({ id: selected.id, body: { clear_reminder: true } });
                          return;
                        }
                        patchMut.mutate({ id: selected.id, body: { reminder_at: iso } });
                      }}
                      className="rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900/50"
                    />
                    {selected.reminder_at && !inTrash && (
                      <button
                        type="button"
                        onClick={() => patchMut.mutate({ id: selected.id, body: { clear_reminder: true } })}
                        className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-black/5 dark:text-slate-300"
                      >
                        <BellOff className="h-3.5 w-3.5" />
                        Снять
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-slate-700/70">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-slate-400" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Вложения</span>
                    </div>
                    {!inTrash && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,.pdf,.txt,.doc,.docx,.zip"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) uploadMut.mutate(f);
                          }}
                        />
                        <button
                          type="button"
                          disabled={uploadMut.isPending}
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                        >
                          <ImagePlus className="h-3.5 w-3.5" />
                          Загрузить
                        </button>
                      </>
                    )}
                  </div>
                  {selected.attachments.length === 0 && (
                    <p className="text-xs text-slate-400">Файлов пока нет</p>
                  )}
                  <ul className="space-y-2">
                    {selected.attachments.map((att) => {
                      const isImage = att.content_type.startsWith("image/");
                      return (
                        <li
                          key={att.id}
                          className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-white/50 p-2 dark:border-slate-700 dark:bg-slate-900/40"
                        >
                          {isImage ? (
                            <a href={att.url} target="_blank" rel="noreferrer" className="shrink-0">
                              <img
                                src={att.url}
                                alt={att.filename}
                                className="h-16 w-16 rounded-lg object-cover"
                              />
                            </a>
                          ) : (
                            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                              <Paperclip className="h-5 w-5 text-slate-400" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-sm font-medium text-sky-700 hover:underline dark:text-sky-300"
                            >
                              {att.filename}
                            </a>
                            <p className="text-[11px] text-slate-400">
                              {Math.max(1, Math.round(att.size_bytes / 1024))} КБ
                            </p>
                          </div>
                          {!inTrash && (
                            <button
                              type="button"
                              onClick={() => deleteAttachmentMut.mutate(att.id)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => !deleteMut.isPending && setDeleteOpen(false)}
        onConfirm={() => selected && deleteMut.mutate(selected.id)}
        title="Удалить навсегда?"
        message="Заметка и вложения будут удалены без возможности восстановления."
        confirmLabel="Удалить навсегда"
        variant="danger"
        pending={deleteMut.isPending}
        lockWhilePending
      />
    </AppShell>
  );
}
