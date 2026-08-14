import { apiFetch } from "./client";

export type NoteColor =
  | "default"
  | "coral"
  | "peach"
  | "sand"
  | "mint"
  | "fog"
  | "lavender"
  | "slate";

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type PersonalNoteTagOut = {
  id: string;
  name: string;
  created_at: string;
};

export type PersonalNoteAttachmentOut = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
};

export type PersonalNoteOut = {
  id: string;
  title: string;
  content: string;
  color: NoteColor | string;
  checklist_items: ChecklistItem[];
  is_pinned: boolean;
  is_archived: boolean;
  reminder_at: string | null;
  reminder_repeat_daily?: boolean;
  deleted_at: string | null;
  tags: PersonalNoteTagOut[];
  attachments: PersonalNoteAttachmentOut[];
  created_at: string;
  updated_at: string;
};

export type PersonalNoteCreate = {
  title?: string;
  content?: string;
  color?: string;
  checklist_items?: ChecklistItem[];
  is_pinned?: boolean;
  is_archived?: boolean;
  reminder_at?: string | null;
  reminder_repeat_daily?: boolean;
  tag_ids?: string[];
};

export type PersonalNoteUpdate = {
  title?: string;
  content?: string;
  color?: string;
  checklist_items?: ChecklistItem[];
  is_pinned?: boolean;
  is_archived?: boolean;
  reminder_at?: string | null;
  reminder_repeat_daily?: boolean;
  clear_reminder?: boolean;
  tag_ids?: string[];
};

export type NoteScope = "active" | "archived" | "trash" | "all";

export type ListNotesParams = {
  q?: string;
  scope?: NoteScope;
  tag_id?: string;
  limit?: number;
};

export async function listNotes(params?: ListNotesParams): Promise<PersonalNoteOut[]> {
  const sp = new URLSearchParams();
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.scope) sp.set("scope", params.scope);
  if (params?.tag_id) sp.set("tag_id", params.tag_id);
  if (typeof params?.limit === "number") sp.set("limit", String(params.limit));
  const qs = sp.toString();
  return apiFetch<PersonalNoteOut[]>(`/api/v1/notes${qs ? `?${qs}` : ""}`);
}

export async function createNote(body?: PersonalNoteCreate): Promise<PersonalNoteOut> {
  return apiFetch<PersonalNoteOut>("/api/v1/notes", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export async function updateNote(noteId: string, body: PersonalNoteUpdate): Promise<PersonalNoteOut> {
  return apiFetch<PersonalNoteOut>(`/api/v1/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function trashNote(noteId: string): Promise<PersonalNoteOut> {
  return apiFetch<PersonalNoteOut>(`/api/v1/notes/${noteId}/trash`, { method: "POST" });
}

export async function restoreNote(noteId: string): Promise<PersonalNoteOut> {
  return apiFetch<PersonalNoteOut>(`/api/v1/notes/${noteId}/restore`, { method: "POST" });
}

export async function deleteNote(noteId: string, permanent = false): Promise<void> {
  const q = permanent ? "?permanent=true" : "";
  await apiFetch<void>(`/api/v1/notes/${noteId}${q}`, { method: "DELETE" });
}

export async function listNoteTags(): Promise<PersonalNoteTagOut[]> {
  return apiFetch<PersonalNoteTagOut[]>("/api/v1/notes/tags");
}

export async function createNoteTag(name: string): Promise<PersonalNoteTagOut> {
  return apiFetch<PersonalNoteTagOut>("/api/v1/notes/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteNoteTag(tagId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/notes/tags/${tagId}`, { method: "DELETE" });
}

export async function uploadNoteAttachment(noteId: string, file: File): Promise<PersonalNoteAttachmentOut> {
  const form = new FormData();
  form.set("file", file);
  return apiFetch<PersonalNoteAttachmentOut>(`/api/v1/notes/${noteId}/attachments`, {
    method: "POST",
    body: form,
  });
}

export async function deleteNoteAttachment(noteId: string, attachmentId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/notes/${noteId}/attachments/${attachmentId}`, { method: "DELETE" });
}

export const NOTE_COLOR_OPTIONS: { id: NoteColor; label: string; swatch: string }[] = [
  { id: "default", label: "Обычный", swatch: "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600" },
  { id: "coral", label: "Коралл", swatch: "bg-rose-200 dark:bg-rose-900/70" },
  { id: "peach", label: "Персик", swatch: "bg-orange-200 dark:bg-orange-900/60" },
  { id: "sand", label: "Песок", swatch: "bg-amber-100 dark:bg-amber-900/50" },
  { id: "mint", label: "Мята", swatch: "bg-emerald-100 dark:bg-emerald-900/50" },
  { id: "fog", label: "Туман", swatch: "bg-sky-100 dark:bg-sky-900/50" },
  { id: "lavender", label: "Лаванда", swatch: "bg-violet-100 dark:bg-violet-900/50" },
  { id: "slate", label: "Сланец", swatch: "bg-slate-200 dark:bg-slate-700" },
];

export function noteSurfaceClass(color: string | undefined): string {
  switch (color) {
    case "coral":
      return "bg-rose-50 dark:bg-rose-950/35";
    case "peach":
      return "bg-orange-50 dark:bg-orange-950/30";
    case "sand":
      return "bg-amber-50 dark:bg-amber-950/30";
    case "mint":
      return "bg-emerald-50 dark:bg-emerald-950/30";
    case "fog":
      return "bg-sky-50 dark:bg-sky-950/30";
    case "lavender":
      return "bg-violet-50 dark:bg-violet-950/30";
    case "slate":
      return "bg-slate-100 dark:bg-slate-800/80";
    default:
      return "bg-white/80 dark:bg-slate-900/60";
  }
}

export function newChecklistItem(text = ""): ChecklistItem {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, text, done: false };
}
