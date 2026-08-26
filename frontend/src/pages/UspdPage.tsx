import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  createUspdEntry,
  createUspdHwModel,
  createUspdSite,
  deleteUspdEntry,
  deleteUspdSite,
  listUspdHwModels,
  listUspdSites,
  updateUspdEntry,
  updateUspdSite,
  type UspdEntryOut,
  type UspdSiteOut,
} from "../api/uspd";
import { AppShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreatableSearchSelect } from "../components/CreatableSearchSelect";
import { MarkdownNotesEditor } from "../components/MarkdownNotesEditor";
import { Modal } from "../components/Modal";
import { SecretField } from "../components/SecretField";
import { invalidateAndRefetch } from "../lib/queryClient";
import { toastApiError, toastSuccess } from "../lib/toast";
import { useToastQueryError } from "../lib/useToastQueryError";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none ring-sky-400/30 focus:border-sky-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

const th =
  "border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300";
const td = "border border-slate-200 px-2.5 py-1 align-middle text-sm dark:border-slate-600";

function dash(v: string | null | undefined): string {
  const t = v?.trim();
  return t ? t : "";
}

type ConfirmState =
  | { kind: "site"; id: string; name: string }
  | { kind: "entry"; siteId: string; id: string; name: string }
  | null;

type ModelHit = {
  model: string;
  object: string;
  siteId: string;
  siteName: string;
  ip: string | null;
  comment: string | null;
};

type Editor =
  | { kind: "site"; site?: UspdSiteOut }
  | {
      kind: "entry";
      site: UspdSiteOut;
      entry?: UspdEntryOut;
      section?: string;
      parent?: UspdEntryOut;
      asSim?: boolean;
    }
  | null;

function isGsmRow(object: string): boolean {
  return /^gsm$/i.test(object.trim());
}

function isBsRow(object: string): boolean {
  return /^(бс|bs)\b/i.test(object.trim()) || /базов\w*\s*станц/i.test(object);
}

function isPhoneLike(object: string): boolean {
  return /gsm|телефон|телеофис|телефонис/i.test(object);
}

function isSimRow(row: UspdEntryOut): boolean {
  if (!row.parent_id) return false;
  if (/^sim(\s+\d+)?$/i.test(row.object.trim())) return true;
  return !!(row.sim_number || row.sim_ip || row.sim_iccid || row.sim_pin || row.sim_puk);
}

type SimDraft = {
  id?: string;
  object: string;
  sim_number: string;
  sim_ip: string;
  sim_iccid: string;
  sim_pin: string;
  sim_puk: string;
  comment: string;
};

function simKidsOf(site: UspdSiteOut, parentId: string): UspdEntryOut[] {
  return sortEntries(site.entries.filter((e) => e.parent_id === parentId && isSimRow(e)));
}

function nextSimLabel(existing: { object: string }[]): string {
  const used = new Set<number>();
  existing.forEach((s, i) => {
    const t = s.object.trim();
    const numbered = /^sim\s+(\d+)$/i.exec(t);
    if (numbered) used.add(Number(numbered[1]));
    else if (/^sim$/i.test(t)) used.add(i + 1);
  });
  let n = 1;
  while (used.has(n)) n += 1;
  return `SIM ${n}`;
}

function emptySimDraft(label: string): SimDraft {
  return {
    object: label,
    sim_number: "",
    sim_ip: "",
    sim_iccid: "",
    sim_pin: "",
    sim_puk: "",
    comment: "",
  };
}

function simDraftFromRow(row: UspdEntryOut, index: number): SimDraft {
  const raw = row.object?.trim() || "";
  const object = raw && !/^sim$/i.test(raw) ? raw : `SIM ${index + 1}`;
  return {
    id: row.id,
    object,
    sim_number: row.sim_number ?? "",
    sim_ip: row.sim_ip ?? "",
    sim_iccid: row.sim_iccid ?? "",
    sim_pin: row.sim_pin ?? "",
    sim_puk: row.sim_puk ?? "",
    comment: row.comment ?? "",
  };
}

function simDraftIsEmpty(sim: SimDraft): boolean {
  return ![sim.sim_number, sim.sim_ip, sim.sim_iccid, sim.sim_pin, sim.sim_puk, sim.comment].some((v) => v.trim());
}

function sortEntries(rows: UspdEntryOut[]): UspdEntryOut[] {
  return [...rows].sort(
    (a, b) => a.sort_order - b.sort_order || a.object.localeCompare(b.object, "ru") || a.id.localeCompare(b.id),
  );
}

function siblingGroup(site: UspdSiteOut, row: UspdEntryOut): UspdEntryOut[] {
  if (!row.parent_id) {
    const section = row.section?.trim() || "";
    return sortEntries(
      site.entries.filter((e) => !e.parent_id && (e.section?.trim() || "") === section),
    );
  }
  const kids = site.entries.filter((e) => e.parent_id === row.parent_id);
  if (isSimRow(row)) return sortEntries(kids.filter(isSimRow));
  return sortEntries(kids.filter((e) => !isSimRow(e)));
}

function ordersAfterMove(
  siblings: UspdEntryOut[],
  id: string,
  direction: "up" | "down",
): { id: string; sort_order: number }[] | null {
  const ordered = sortEntries(siblings);
  const idx = ordered.findIndex((r) => r.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return null;
  const next = [...ordered];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  return next.map((r, i) => ({ id: r.id, sort_order: i }));
}

export function UspdPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageTab = searchParams.get("tab") === "models" ? "models" : "sites";
  const activeId = searchParams.get("site");
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [movingEntryId, setMovingEntryId] = useState<string | null>(null);

  const setPageTab = (tab: "sites" | "models") => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "models") next.set("tab", "models");
        else next.delete("tab");
        return next;
      },
      { replace: true },
    );
  };

  const setActiveId = (id: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("site", id);
        else next.delete("site");
        return next;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(search), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const listQuery = useQuery({
    queryKey: ["uspd", "list", debouncedQ],
    queryFn: () => listUspdSites(debouncedQ),
  });
  const modelsQuery = useQuery({
    queryKey: ["uspd", "models"],
    queryFn: listUspdHwModels,
  });
  useToastQueryError(listQuery.error, "Не удалось загрузить УСПД");
  useToastQueryError(modelsQuery.error, "Не удалось загрузить модели");

  const sites = listQuery.data ?? [];
  const filtered = useMemo(() => {
    const k = kindFilter.trim().toLowerCase();
    if (!k) return sites;
    if (k === "gsm") {
      return sites.filter((s) =>
        s.entries.some((e) => isPhoneLike(e.object) || isSimRow(e) || !!(e.sim_number || e.sim_ip)),
      );
    }
    return sites.filter((s) =>
      s.entries.some(
        (e) =>
          (e.object || "").toLowerCase().includes(k) || (e.model || "").toLowerCase().includes(k),
      ),
    );
  }, [sites, kindFilter]);

  const knownModels = useMemo(() => {
    const set = new Map<string, string>();
    for (const m of modelsQuery.data ?? []) {
      const name = m.name.trim();
      if (name) set.set(name.toLowerCase(), name);
    }
    for (const s of sites) {
      for (const e of s.entries) {
        const name = e.model?.trim();
        if (name && !set.has(name.toLowerCase())) set.set(name.toLowerCase(), name);
      }
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [modelsQuery.data, sites]);

  useEffect(() => {
    if (pageTab !== "sites" || listQuery.isPending) return;
    if (filtered.length === 0) return;
    if (!activeId || !filtered.some((s) => s.id === activeId)) {
      setActiveId(filtered[0].id);
    }
  }, [filtered, activeId, pageTab, listQuery.isPending]);

  const activeSite = useMemo(
    () => filtered.find((s) => s.id === activeId) ?? null,
    [filtered, activeId],
  );

  const createMut = useMutation({
    mutationFn: (name: string) => createUspdSite({ name }),
    onSuccess: async (row) => {
      await invalidateAndRefetch(qc, ["uspd"]);
      setActiveId(row.id);
      toastSuccess("Объект создан");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось создать"),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!confirm) return;
      if (confirm.kind === "site") await deleteUspdSite(confirm.id);
      else await deleteUspdEntry(confirm.siteId, confirm.id);
    },
    onSuccess: async () => {
      const wasSite = confirm?.kind === "site";
      const id = confirm?.kind === "site" ? confirm.id : null;
      setConfirm(null);
      if (wasSite && id && activeId === id) setActiveId(null);
      await invalidateAndRefetch(qc, ["uspd"]);
      toastSuccess("Удалено");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить"),
  });

  const moveEntry = async (row: UspdEntryOut, direction: "up" | "down") => {
    if (!activeSite || movingEntryId) return;
    const siblings = siblingGroup(activeSite, row);
    const next = ordersAfterMove(siblings, row.id, direction);
    if (!next) return;
    const byId = new Map(siblings.map((s) => [s.id, s]));
    const changes = next.filter((item) => byId.get(item.id)?.sort_order !== item.sort_order);
    if (!changes.length) return;
    const listKey = ["uspd", "list", debouncedQ] as const;
    const prev = qc.getQueryData<UspdSiteOut[]>(listKey);
    const pos = new Map(next.map((item) => [item.id, item.sort_order]));
    qc.setQueryData<UspdSiteOut[]>(listKey, (old) => {
      if (!old) return old;
      return old.map((site) =>
        site.id !== activeSite.id
          ? site
          : {
              ...site,
              entries: site.entries.map((e) =>
                pos.has(e.id) ? { ...e, sort_order: pos.get(e.id)! } : e,
              ),
            },
      );
    });
    setMovingEntryId(row.id);
    try {
      await Promise.all(
        changes.map((item) => updateUspdEntry(activeSite.id, item.id, { sort_order: item.sort_order })),
      );
      await invalidateAndRefetch(qc, ["uspd"]);
    } catch (e) {
      if (prev) qc.setQueryData(listKey, prev);
      toastApiError(e, "Не удалось изменить порядок");
    } finally {
      setMovingEntryId(null);
    }
  };

  return (
    <AppShell title="УСПД" subtitle="Object — тип (GSM, Cisco, сервер). Model — линейка (LT40, Simatic, IROBO)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-700">
          {(
            [
              ["sites", "Объекты"],
              ["models", "Модели"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPageTab(id)}
              className={`rounded-md px-3 py-1.5 font-medium ${
                pageTab === id
                  ? "bg-sky-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              pageTab === "models"
                ? "Поиск по модели, объекту, IP…"
                : "Поиск по объекту, модели, IP, SIM, комментарию…"
            }
            className={`${inputClass} pl-9 py-2`}
          />
        </div>
        {pageTab === "sites" && (
          <div className="flex flex-wrap gap-1">
            {[
              ["", "Все"],
              ["cisco", "Cisco"],
              ["бс", "БС"],
              ["gsm", "GSM / телефонис"],
              ["chirp", "ChirpStack"],
            ].map(([id, label]) => (
              <button
                key={id || "all"}
                type="button"
                onClick={() => setKindFilter(id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  kindFilter === id
                    ? "bg-sky-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setEditor({ kind: "site" })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
        >
          <Plus className="h-4 w-4" />
          Объект
        </button>
      </div>

      {pageTab === "models" ? (
        <ModelsPanel
          sites={sites}
          catalogNames={knownModels}
          pending={listQuery.isPending}
          search={debouncedQ}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onOpenSite={(siteId) => {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.delete("tab");
                next.set("site", siteId);
                return next;
              },
              { replace: true },
            );
          }}
        />
      ) : (
      <div className="flex min-h-[calc(100vh-12rem)] flex-col gap-3 lg:flex-row lg:items-start">
        <nav className="max-h-56 shrink-0 overflow-y-auto rounded-xl border border-slate-200/80 bg-white/80 p-2 dark:border-slate-700 dark:bg-slate-900/60 lg:sticky lg:top-4 lg:max-h-[calc(100vh-10rem)] lg:w-64">
          <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Объекты {filtered.length ? `· ${filtered.length}` : ""}
          </p>
          {listQuery.isPending && <p className="p-2 text-xs text-slate-500">Загрузка…</p>}
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                activeId === s.id
                  ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {s.name}
            </button>
          ))}
          {!listQuery.isPending && filtered.length === 0 && (
            <p className="p-2 text-xs text-slate-500">Ничего не найдено</p>
          )}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-slate-200/80 bg-white px-4 py-3 font-sans dark:border-slate-700 dark:bg-slate-900 sm:px-6">
          {listQuery.isPending && <p className="py-10 text-center text-sm text-slate-500">Загрузка…</p>}
          {!listQuery.isPending && filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-500">
              Пока пусто. Создайте объект — как заголовок в заметке.
            </p>
          )}
          {activeSite && (
            <SiteNote
              site={activeSite}
              onEditSite={() => setEditor({ kind: "site", site: activeSite })}
              onDeleteSite={() => setConfirm({ kind: "site", id: activeSite.id, name: activeSite.name })}
              onAddRow={(section) => setEditor({ kind: "entry", site: activeSite, section })}
              onAddChild={(parent, asSim) =>
                setEditor({
                  kind: "entry",
                  site: activeSite,
                  parent,
                  asSim,
                  section: parent.section ?? undefined,
                })
              }
              onEditRow={(entry) =>
                setEditor({
                  kind: "entry",
                  site: activeSite,
                  entry,
                  asSim: isSimRow(entry),
                  parent: activeSite.entries.find((e) => e.id === entry.parent_id),
                })
              }
              onDeleteRow={(entry) =>
                setConfirm({
                  kind: "entry",
                  siteId: activeSite.id,
                  id: entry.id,
                  name: [entry.object, entry.model].filter(Boolean).join(" ") || entry.ip || "строка",
                })
              }
              onMoveRow={moveEntry}
              movingEntryId={movingEntryId}
            />
          )}
        </div>
      </div>
      )}

      {editor && (
        <NoteEditor
          key={
            editor.kind === "site"
              ? `site-${editor.site?.id ?? "new"}`
              : `entry-${editor.entry?.id ?? "new"}-${editor.parent?.id ?? ""}-${editor.asSim ? "sim" : "row"}`
          }
          editor={editor}
          pendingCreate={createMut.isPending}
          onClose={() => setEditor(null)}
          knownModels={knownModels}
          onCreateSite={async (name, notes) => {
            const row = await createMut.mutateAsync(name);
            if (notes.trim()) await updateUspdSite(row.id, { notes });
            await invalidateAndRefetch(qc, ["uspd"]);
            setEditor(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        onClose={() => !deleteMut.isPending && setConfirm(null)}
        onConfirm={() => deleteMut.mutate()}
        title={confirm?.kind === "site" ? "Удалить объект?" : "Удалить строку?"}
        message={
          confirm?.kind === "site" ? (
            <>
              Будет удалён <strong>{confirm.name}</strong> и вся таблица по нему.
            </>
          ) : (
            <>
              Удалить <strong>{confirm?.name}</strong>?
            </>
          )
        }
        confirmLabel="Удалить"
        variant="danger"
        pending={deleteMut.isPending}
      />
    </AppShell>
  );
}

function groupEntries(entries: UspdEntryOut[]): { section: string | null; rows: UspdEntryOut[] }[] {
  const order: string[] = [];
  const map = new Map<string, UspdEntryOut[]>();
  for (const row of entries) {
    if (row.parent_id) continue;
    const key = row.section?.trim() || "";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(row);
  }
  return order.map((key) => ({
    section: key || null,
    rows: sortEntries(map.get(key)!),
  }));
}

function UspdSiteNotes({ site }: { site: UspdSiteOut }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(site.notes ?? "");

  useEffect(() => {
    if (!editing) setDraft(site.notes ?? "");
  }, [site.id, site.notes, editing]);

  const saveMut = useMutation({
    mutationFn: () => updateUspdSite(site.id, { notes: draft.trim() || null }),
    onSuccess: async () => {
      await invalidateAndRefetch(qc, ["uspd"]);
      setEditing(false);
      toastSuccess("Заметки сохранены");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить заметки"),
  });

  const hasNotes = Boolean(site.notes?.trim());

  return (
    <section className="mt-6 rounded-xl border border-slate-200/90 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Заметки</h3>
        {editing ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={saveMut.isPending}
              onClick={() => {
                setDraft(site.notes ?? "");
                setEditing(false);
              }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate()}
              className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {saveMut.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(site.notes ?? "");
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
          >
            <Pencil className="h-3.5 w-3.5" />
            {hasNotes ? "Изменить" : "Добавить"}
          </button>
        )}
      </div>
      {editing ? (
        <MarkdownNotesEditor
          key={`${site.id}-edit`}
          value={draft}
          onChange={setDraft}
          placeholder="Доп. информация по объекту. Скриншот — Ctrl+V, картинка — кнопка на панели"
        />
      ) : hasNotes ? (
        <MarkdownNotesEditor key={`${site.id}-view`} value={site.notes ?? ""} editable={false} />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Пока пусто.
        </p>
      )}
    </section>
  );
}

function SiteNote({
  site,
  onEditSite,
  onDeleteSite,
  onAddRow,
  onAddChild,
  onEditRow,
  onDeleteRow,
  onMoveRow,
  movingEntryId,
}: {
  site: UspdSiteOut;
  onEditSite: () => void;
  onDeleteSite: () => void;
  onAddRow: (section?: string) => void;
  onAddChild: (parent: UspdEntryOut, asSim?: boolean) => void;
  onEditRow: (row: UspdEntryOut) => void;
  onDeleteRow: (row: UspdEntryOut) => void;
  onMoveRow: (row: UspdEntryOut, direction: "up" | "down") => void;
  movingEntryId: string | null;
}) {
  const groups = groupEntries(site.entries);
  const childrenOf = (id: string) => sortEntries(site.entries.filter((e) => e.parent_id === id));
  return (
    <article>
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{site.name}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEditSite}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            title="Переименовать"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDeleteSite}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
            title="Удалить объект"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>
      {groups.length === 0 ? (
        <div>
          <EmptyTable />
          <AddRowBtn onClick={() => onAddRow()} />
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.section || "_"} className="mb-4">
            {g.section && (
              <h3 className="mb-1.5 mt-4 text-lg font-semibold text-slate-800 dark:text-slate-100">
                {g.section}
              </h3>
            )}
            <ObsidianTable
              rows={g.rows}
              childrenOf={childrenOf}
              onEdit={onEditRow}
              onDelete={onDeleteRow}
              onAddChild={onAddChild}
              onMove={onMoveRow}
              movingEntryId={movingEntryId}
            />
            <AddRowBtn onClick={() => onAddRow(g.section ?? undefined)} />
          </div>
        ))
      )}
      <UspdSiteNotes site={site} />
    </article>
  );
}

function EmptyTable() {
  return (
    <table className="mb-1 w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className={th}>Object</th>
          <th className={th}>Model</th>
          <th className={th}>Ip</th>
          <th className={th}>Cred</th>
          <th className={th}>Comment</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className={`${td} text-slate-400`} colSpan={5}>
            Нет строк
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function ObsidianTable({
  rows,
  childrenOf,
  onEdit,
  onDelete,
  onAddChild,
  onMove,
  movingEntryId,
}: {
  rows: UspdEntryOut[];
  childrenOf: (id: string) => UspdEntryOut[];
  onEdit: (row: UspdEntryOut) => void;
  onDelete: (row: UspdEntryOut) => void;
  onAddChild: (parent: UspdEntryOut, asSim?: boolean) => void;
  onMove: (row: UspdEntryOut, direction: "up" | "down") => void;
  movingEntryId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="mb-1 w-full min-w-[46rem] border-collapse">
        <thead>
          <tr>
            <th className={th}>Object</th>
            <th className={th}>Model</th>
            <th className={th}>Ip</th>
            <th className={th}>Cred</th>
            <th className={th}>Comment</th>
            <th className={`${th} w-36`} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const kids = childrenOf(row.id);
            return (
              <EntryBlock
                key={row.id}
                row={row}
                kids={kids}
                canMoveUp={index > 0}
                canMoveDown={index < rows.length - 1}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={onAddChild}
                onMove={onMove}
                movingEntryId={movingEntryId}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MoveBtns({
  canUp,
  canDown,
  disabled,
  onUp,
  onDown,
}: {
  canUp: boolean;
  canDown: boolean;
  disabled?: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <>
      <button
        type="button"
        disabled={!canUp || disabled}
        onClick={onUp}
        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
        title="Выше"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={!canDown || disabled}
        onClick={onDown}
        className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
        title="Ниже"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

function EntryBlock({
  row,
  kids,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onAddChild,
  onMove,
  movingEntryId,
}: {
  row: UspdEntryOut;
  kids: UspdEntryOut[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: (row: UspdEntryOut) => void;
  onDelete: (row: UspdEntryOut) => void;
  onAddChild: (parent: UspdEntryOut, asSim?: boolean) => void;
  onMove: (row: UspdEntryOut, direction: "up" | "down") => void;
  movingEntryId: string | null;
}) {
  const gsm = isGsmRow(row.object);
  const simKids = kids.filter(isSimRow);
  const otherKids = kids.filter((child) => !isSimRow(child));
  const [simsOpen, setSimsOpen] = useState(true);
  const prevSimCount = useRef(simKids.length);

  useEffect(() => {
    if (simKids.length > prevSimCount.current) setSimsOpen(true);
    prevSimCount.current = simKids.length;
  }, [simKids.length]);

  return (
    <>
      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
        <td className={`${td} whitespace-nowrap font-medium`}>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex flex-col">
              <span>{dash(row.object) || "—"}</span>
              {dash(row.device_eui) && (
                <span className="font-mono text-[11px] font-normal text-slate-400">EUI {row.device_eui}</span>
              )}
            </span>
            {simKids.length > 0 && (
              <button
                type="button"
                onClick={() => setSimsOpen((v) => !v)}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title={simsOpen ? "Скрыть SIM" : "Показать SIM"}
                aria-expanded={simsOpen}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition ${simsOpen ? "" : "-rotate-90"}`} />
                SIM {simKids.length}
              </button>
            )}
          </span>
        </td>
        <td className={`${td} whitespace-nowrap font-mono text-[13px]`}>{dash(row.model) || "—"}</td>
        <td className={`${td} font-mono text-[13px]`}>
          <IpCell value={row.ip} />
        </td>
        <td className={td}>
          <CredCell username={row.username} password={row.password} />
        </td>
        <td className={`${td} text-slate-600 dark:text-slate-300`}>{dash(row.comment)}</td>
        <td className={`${td} whitespace-nowrap text-right`}>
          <MoveBtns
            canUp={canMoveUp}
            canDown={canMoveDown}
            disabled={!!movingEntryId}
            onUp={() => onMove(row, "up")}
            onDown={() => onMove(row, "down")}
          />
          {gsm && (
            <button
              type="button"
              onClick={() => onAddChild(row, true)}
              className="rounded px-1 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300"
              title={simKids.length ? "Ещё SIM" : "Добавить SIM"}
            >
              {simKids.length ? "Ещё SIM" : "+ SIM"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(row)}
            className="rounded p-1 text-slate-400 hover:text-slate-700"
            title="Изменить"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(row)}
            className="rounded p-1 text-slate-400 hover:text-red-600"
            title="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
      {simsOpen &&
        simKids.map((child, index) => (
          <SimSubRow
            key={child.id}
            row={child}
            index={index}
            canMoveUp={index > 0}
            canMoveDown={index < simKids.length - 1}
            disabled={!!movingEntryId}
            onEdit={onEdit}
            onDelete={onDelete}
            onMove={onMove}
          />
        ))}
      {otherKids.map((child, index) => (
        <GenericSubRow
          key={child.id}
          row={child}
          canMoveUp={index > 0}
          canMoveDown={index < otherKids.length - 1}
          disabled={!!movingEntryId}
          onEdit={onEdit}
          onDelete={onDelete}
          onMove={onMove}
        />
      ))}
    </>
  );
}

function SimSubRow({
  row,
  index,
  canMoveUp,
  canMoveDown,
  disabled,
  onEdit,
  onDelete,
  onMove,
}: {
  row: UspdEntryOut;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
  onEdit: (row: UspdEntryOut) => void;
  onDelete: (row: UspdEntryOut) => void;
  onMove: (row: UspdEntryOut, direction: "up" | "down") => void;
}) {
  const label = row.object?.trim() && !/^sim$/i.test(row.object.trim()) ? row.object.trim() : `SIM ${index + 1}`;
  return (
    <tr className="bg-slate-50/90 dark:bg-slate-800/40">
      <td className={`${td} text-xs`} colSpan={5}>
        <div className="ml-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-sky-300 pl-3 dark:border-sky-700">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span>
          <span>
            <span className="text-slate-400">номер </span>
            <span className="font-mono">{dash(row.sim_number) || "—"}</span>
          </span>
          <span>
            <span className="text-slate-400">IP </span>
            <span className="font-mono">{dash(row.sim_ip) || "—"}</span>
          </span>
          <span>
            <span className="text-slate-400">ICCID </span>
            <span className="font-mono">{dash(row.sim_iccid) || "—"}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-400">PIN</span>
            <SecretField value={row.sim_pin} readOnly size="sm" />
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-slate-400">PUK</span>
            <SecretField value={row.sim_puk} readOnly size="sm" />
          </span>
          {row.comment?.trim() && <span className="text-slate-500">{row.comment}</span>}
        </div>
      </td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <MoveBtns
          canUp={canMoveUp}
          canDown={canMoveDown}
          disabled={disabled}
          onUp={() => onMove(row, "up")}
          onDown={() => onMove(row, "down")}
        />
        <button type="button" onClick={() => onEdit(row)} className="rounded p-1 text-slate-400 hover:text-slate-700">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onDelete(row)} className="rounded p-1 text-slate-400 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function GenericSubRow({
  row,
  canMoveUp,
  canMoveDown,
  disabled,
  onEdit,
  onDelete,
  onMove,
}: {
  row: UspdEntryOut;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
  onEdit: (row: UspdEntryOut) => void;
  onDelete: (row: UspdEntryOut) => void;
  onMove: (row: UspdEntryOut, direction: "up" | "down") => void;
}) {
  return (
    <tr className="bg-slate-50/80 dark:bg-slate-800/30">
      <td className={`${td} whitespace-nowrap text-xs`}>
        <span className="ml-5 inline-block border-l-2 border-slate-300 pl-2 dark:border-slate-600">
          {dash(row.object) || "—"}
        </span>
      </td>
      <td className={`${td} whitespace-nowrap font-mono text-xs`}>{dash(row.model)}</td>
      <td className={`${td} font-mono text-xs`}>
        <IpCell value={row.ip} />
      </td>
      <td className={td}>
        <CredCell username={row.username} password={row.password} />
      </td>
      <td className={`${td} text-xs text-slate-600 dark:text-slate-300`}>{dash(row.comment)}</td>
      <td className={`${td} whitespace-nowrap text-right`}>
        <MoveBtns
          canUp={canMoveUp}
          canDown={canMoveDown}
          disabled={disabled}
          onUp={() => onMove(row, "up")}
          onDown={() => onMove(row, "down")}
        />
        <button type="button" onClick={() => onEdit(row)} className="rounded p-1 text-slate-400 hover:text-slate-700">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onDelete(row)} className="rounded p-1 text-slate-400 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function IpCell({ value }: { value: string | null }) {
  const v = value?.trim();
  if (!v) return <span className="text-slate-400">—</span>;
  if (/^https?:\/\//i.test(v)) {
    return (
      <a href={v} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline dark:text-sky-300">
        {v}
      </a>
    );
  }
  return <span>{v}</span>;
}

function CredCell({ username, password }: { username: string | null; password: string }) {
  const user = username?.trim();
  if (!user && !password) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      <span className="whitespace-nowrap font-mono text-[13px]">{user ? `${user}/` : ""}</span>
      {password ? <SecretField value={password} readOnly size="sm" /> : null}
    </div>
  );
}

function ModelsPanel({
  sites,
  catalogNames,
  pending,
  search,
  selectedModel,
  onSelectModel,
  onOpenSite,
}: {
  sites: UspdSiteOut[];
  catalogNames: string[];
  pending: boolean;
  search: string;
  selectedModel: string;
  onSelectModel: (key: string) => void;
  onOpenSite: (siteId: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: ModelHit[] }>();
    for (const site of sites) {
      for (const e of site.entries) {
        if (e.parent_id) continue;
        const raw = e.model?.trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        const g = map.get(key) ?? { label: raw, items: [] };
        g.items.push({
          model: raw,
          object: e.object,
          siteId: site.id,
          siteName: site.name,
          ip: e.ip,
          comment: e.comment,
        });
        map.set(key, g);
      }
    }
    for (const name of catalogNames) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { label: name, items: [] });
    }
    return [...map.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "ru"));
  }, [sites, catalogNames]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const base = selectedModel ? groups.filter(([key]) => key === selectedModel) : groups;
    if (!needle) return base;
    return base
      .map(([key, g]) => {
        if (g.label.toLowerCase().includes(needle)) return [key, g] as const;
        const items = g.items.filter(
          (h) =>
            h.siteName.toLowerCase().includes(needle) ||
            h.object.toLowerCase().includes(needle) ||
            (h.ip || "").toLowerCase().includes(needle) ||
            (h.comment || "").toLowerCase().includes(needle),
        );
        if (!items.length) return null;
        return [key, { ...g, items }] as const;
      })
      .filter((row): row is readonly [string, { label: string; items: ModelHit[] }] => row !== null);
  }, [groups, search, selectedModel]);
  const totalUnits = groups.reduce((n, [, g]) => n + g.items.length, 0);

  return (
    <div className="flex min-h-[calc(100vh-12rem)] gap-3">
      <nav className="hidden w-56 shrink-0 overflow-y-auto rounded-xl border border-slate-200/80 bg-white/80 p-2 dark:border-slate-700 dark:bg-slate-900/60 lg:block">
        <button
          type="button"
          onClick={() => onSelectModel("")}
          className={`mb-1 block w-full truncate rounded-lg px-2 py-1 text-left text-sm ${
            !selectedModel
              ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-300"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          Все модели
          <span className="ml-1 text-xs text-slate-400">{totalUnits}</span>
        </button>
        {groups.map(([key, g]) => (
          <button
            key={key}
            type="button"
            onClick={() => onSelectModel(key)}
            className={`block w-full truncate rounded-lg px-2 py-1 text-left text-sm ${
              selectedModel === key
                ? "bg-sky-500/15 font-medium text-sky-800 dark:text-sky-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {g.label}
            <span className="ml-1 text-xs text-slate-400">{g.items.length}</span>
          </button>
        ))}
        {!pending && groups.length === 0 && (
          <p className="p-2 text-xs text-slate-500">Пока нет заполненных моделей</p>
        )}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
        {pending && <p className="py-10 text-center text-sm text-slate-500">Загрузка…</p>}
        {!pending && groups.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            Укажите Model в строке оборудования или создайте линейку в селекторе — тогда здесь появится сводка,
            на каких объектах они стоят.
          </p>
        )}
        {!pending && groups.length > 0 && shown.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">Ничего не найдено по запросу</p>
        )}
        {shown.map(([key, g]) => (
          <section key={key} className="mb-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900 dark:text-white">
              {g.label}{" "}
              <span className="text-base font-medium text-slate-400">
                {g.items.length} {pluralUnits(g.items.length)}
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>Объект</th>
                    <th className={th}>Object</th>
                    <th className={th}>Ip</th>
                    <th className={th}>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.length === 0 ? (
                    <tr>
                      <td className={`${td} text-slate-400`} colSpan={4}>
                        Пока ни на одном объекте не стоит
                      </td>
                    </tr>
                  ) : (
                    g.items.map((hit, i) => (
                    <tr key={`${hit.siteId}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => onOpenSite(hit.siteId)}
                          className="font-medium text-sky-700 hover:underline dark:text-sky-300"
                        >
                          {hit.siteName}
                        </button>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{dash(hit.object) || "—"}</td>
                      <td className={`${td} font-mono text-[13px]`}>
                        <IpCell value={hit.ip} />
                      </td>
                      <td className={`${td} text-slate-600 dark:text-slate-300`}>{dash(hit.comment)}</td>
                    </tr>
                  ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {/* {!pending && unmodeled > 0 && (
          <p className="text-xs text-slate-400">
            Ещё {unmodeled} {pluralUnits(unmodeled)} без модели — их можно дописать в карточке строки.
          </p>
        )} */}
      </div>
    </div>
  );
}

function pluralUnits(_n: number): string {
  return "шт.";
}

function AddRowBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
    >
      <Plus className="h-3.5 w-3.5" />
      строка
    </button>
  );
}

function NoteEditor({
  editor,
  pendingCreate,
  onClose,
  onCreateSite,
  knownModels,
}: {
  editor: Exclude<Editor, null>;
  pendingCreate: boolean;
  onClose: () => void;
  onCreateSite: (name: string, notes: string) => Promise<void>;
  knownModels: string[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editor.kind === "site" ? editor.site?.name ?? "" : "");
  const [notes, setNotes] = useState(editor.kind === "site" ? editor.site?.notes ?? "" : "");
  const entry = editor.kind === "entry" ? editor.entry : undefined;
  const asSim = editor.kind === "entry" && (editor.asSim || (entry ? isSimRow(entry) : false));
  const existingSims =
    editor.kind === "entry" && entry ? simKidsOf(editor.site, entry.id) : [];
  const [form, setForm] = useState({
    object:
      entry?.object ??
      (asSim
        ? nextSimLabel(editor.kind === "entry" && editor.parent ? simKidsOf(editor.site, editor.parent.id) : [])
        : ""),
    model: entry?.model ?? "",
    device_eui: entry?.device_eui ?? "",
    ip: entry?.ip ?? "",
    username: entry?.username ?? "",
    password: entry?.password ?? "",
    comment: entry?.comment ?? "",
    section: entry?.section ?? (editor.kind === "entry" ? editor.section ?? "" : ""),
    sim_number: entry?.sim_number ?? "",
    sim_ip: entry?.sim_ip ?? "",
    sim_iccid: entry?.sim_iccid ?? "",
    sim_pin: entry?.sim_pin ?? "",
    sim_puk: entry?.sim_puk ?? "",
  });
  const [simDrafts, setSimDrafts] = useState<SimDraft[]>(() =>
    existingSims.map((row, i) => simDraftFromRow(row, i)),
  );
  const [removedSimIds, setRemovedSimIds] = useState<string[]>([]);
  const showGsmSims = !asSim && isGsmRow(form.object);
  const modelOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const item of knownModels) {
      const t = item.trim();
      if (t) set.set(t.toLowerCase(), t);
    }
    const current = (form.model || entry?.model || "").trim();
    if (current && !set.has(current.toLowerCase())) set.set(current.toLowerCase(), current);
    return [...set.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [knownModels, entry?.model, form.model]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editor.kind === "site") {
        if (editor.site) {
          await updateUspdSite(editor.site.id, { name: name.trim(), notes: notes.trim() || null });
          return;
        }
        await onCreateSite(name.trim(), notes);
        return;
      }
      const body = {
        object: asSim ? form.object.trim() || "SIM" : form.object,
        model: asSim ? undefined : form.model,
        device_eui: asSim ? undefined : form.device_eui,
        ip: form.ip,
        username: form.username,
        password: form.password,
        comment: form.comment,
        section: form.section,
        parent_id: editor.parent?.id ?? editor.entry?.parent_id ?? null,
        sim_number: asSim ? form.sim_number : undefined,
        sim_ip: asSim ? form.sim_ip : undefined,
        sim_iccid: asSim ? form.sim_iccid : undefined,
        sim_pin: asSim ? form.sim_pin : undefined,
        sim_puk: asSim ? form.sim_puk : undefined,
      };
      let parentId = editor.entry?.id ?? null;
      if (editor.entry) await updateUspdEntry(editor.site.id, editor.entry.id, body);
      else {
        const created = await createUspdEntry(editor.site.id, body);
        parentId = created.id;
      }
      if (!asSim && parentId && (showGsmSims || simDrafts.length || removedSimIds.length)) {
        for (const id of removedSimIds) {
          await deleteUspdEntry(editor.site.id, id);
        }
        let ord = 0;
        for (const sim of simDrafts) {
          if (!sim.id && simDraftIsEmpty(sim)) continue;
          ord += 1;
          const simBody = {
            object: sim.object.trim() || `SIM ${ord}`,
            parent_id: parentId,
            sim_number: sim.sim_number,
            sim_ip: sim.sim_ip,
            sim_iccid: sim.sim_iccid,
            sim_pin: sim.sim_pin,
            sim_puk: sim.sim_puk,
            comment: sim.comment,
            sort_order: ord,
          };
          if (sim.id) await updateUspdEntry(editor.site.id, sim.id, simBody);
          else await createUspdEntry(editor.site.id, simBody);
        }
      }
    },
    onSuccess: async () => {
      if (editor.kind === "site" && !editor.site) return;
      await invalidateAndRefetch(qc, ["uspd"]);
      onClose();
      toastSuccess("Сохранено");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить"),
  });

  const title =
    editor.kind === "site"
      ? editor.site
        ? "Заголовок объекта"
        : "Новый объект"
      : editor.entry
        ? asSim
          ? "SIM"
          : "Строка"
        : asSim
          ? "SIM-карта"
          : editor.parent
            ? "Подстрока"
            : "Новая строка";

  return (
    <Modal
      open
      onClose={() => !saveMut.isPending && !pendingCreate && onClose()}
      title={title}
      size={editor.kind === "site" && !editor.site ? "lg" : "md"}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm dark:bg-slate-700"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={saveMut.isPending || pendingCreate || (editor.kind === "site" && !name.trim())}
            onClick={() => saveMut.mutate()}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            Сохранить
          </button>
        </>
      }
    >
      {editor.kind === "site" ? (
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Заголовок (# объект)</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          {!editor.site && (
            <label className="block text-sm">
              <span className="mb-1 block text-slate-500">Заметки (Markdown), необязательно</span>
              <MarkdownNotesEditor
                compact
                value={notes}
                onChange={setNotes}
                placeholder="Доп. информация. Скриншот — Ctrl+V"
              />
            </label>
          )}
        </div>
      ) : asSim ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {editor.parent && (
            <p className="sm:col-span-2 text-xs text-slate-500">
              SIM для <span className="font-medium">{editor.parent.object || "GSM"}</span>
              {editor.parent && simKidsOf(editor.site, editor.parent.id).length > 0
                ? ` · уже ${simKidsOf(editor.site, editor.parent.id).length}`
                : ""}
            </p>
          )}
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Слот</span>
            <input
              value={form.object}
              onChange={(e) => setForm((s) => ({ ...s, object: e.target.value }))}
              className={inputClass}
              placeholder="SIM 1, SIM 2…"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Номер SIM</span>
            <input
              autoFocus
              value={form.sim_number}
              onChange={(e) => setForm((s) => ({ ...s, sim_number: e.target.value }))}
              className={inputClass}
              placeholder="89135001039"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">IP SIM</span>
            <input
              value={form.sim_ip}
              onChange={(e) => setForm((s) => ({ ...s, sim_ip: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">ICCID</span>
            <input
              value={form.sim_iccid}
              onChange={(e) => setForm((s) => ({ ...s, sim_iccid: e.target.value }))}
              className={inputClass}
            />
          </label>
          <SecretField
            label="PIN"
            value={form.sim_pin}
            onChange={(v) => setForm((s) => ({ ...s, sim_pin: v }))}
          />
          <SecretField
            label="PUK"
            value={form.sim_puk}
            onChange={(v) => setForm((s) => ({ ...s, sim_puk: v }))}
          />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Comment</span>
            <input
              value={form.comment}
              onChange={(e) => setForm((s) => ({ ...s, comment: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {editor.parent && (
            <p className="sm:col-span-2 text-xs text-slate-500">
              Подстрока для <span className="font-medium">{editor.parent.object || "строки"}</span>
            </p>
          )}
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Object — тип</span>
            <input
              autoFocus
              value={form.object}
              onChange={(e) => setForm((s) => ({ ...s, object: e.target.value }))}
              className={inputClass}
              placeholder="GSM, Cisco ASA, сервер, БС…"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Model — линейка</span>
            <CreatableSearchSelect
              value={form.model}
              options={modelOptions}
              onChange={(v) => setForm((s) => ({ ...s, model: v }))}
              onCreate={async (name) => {
                try {
                  const row = await createUspdHwModel(name);
                  await invalidateAndRefetch(qc, ["uspd"]);
                  return row.name;
                } catch (e) {
                  toastApiError(e, "Не удалось создать модель");
                  throw e;
                }
              }}
              placeholder="Найти или создать…"
              emptyLabel="Без модели"
              searchPlaceholder="LT40, Simatic, IROBO…"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Device EUI {isBsRow(form.object) ? "— для БС" : ""}</span>
            <input
              value={form.device_eui}
              onChange={(e) => setForm((s) => ({ ...s, device_eui: e.target.value }))}
              className={inputClass}
              placeholder="247625fffe703180"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Ip</span>
            <input
              value={form.ip}
              onChange={(e) => setForm((s) => ({ ...s, ip: e.target.value }))}
              className={inputClass}
              placeholder="172.31.99.220:8080"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Логин</span>
            <input
              value={form.username}
              onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))}
              className={inputClass}
              placeholder="root, cimmgr, admin"
            />
          </label>
          <SecretField
            label="Пароль"
            value={form.password}
            onChange={(v) => setForm((s) => ({ ...s, password: v }))}
          />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Comment</span>
            <input
              value={form.comment}
              onChange={(e) => setForm((s) => ({ ...s, comment: e.target.value }))}
              className={inputClass}
              placeholder="Номер SIM, DevEUI, для enable тоже…"
            />
          </label>
          {showGsmSims && (
            <div className="sm:col-span-2 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-600">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  SIM-карты {simDrafts.length ? `· ${simDrafts.length}` : ""}
                </p>
                <button
                  type="button"
                  onClick={() => setSimDrafts((list) => [...list, emptySimDraft(nextSimLabel(list))])}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {simDrafts.length ? "Ещё SIM" : "Добавить SIM"}
                </button>
              </div>
              {simDrafts.length === 0 && (
                <p className="text-xs text-slate-500">У одного GSM может быть несколько SIM — добавьте нужное число.</p>
              )}
              {simDrafts.map((sim, i) => (
                <div
                  key={sim.id ?? `new-${i}`}
                  className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-2 dark:bg-slate-800/60"
                >
                  <div className="sm:col-span-2 flex items-center justify-between gap-2">
                    <input
                      value={sim.object}
                      onChange={(e) =>
                        setSimDrafts((list) =>
                          list.map((s, j) => (j === i ? { ...s, object: e.target.value } : s)),
                        )
                      }
                      className={`${inputClass} max-w-[8rem] font-medium`}
                      placeholder={`SIM ${i + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const row = simDrafts[i];
                        if (row.id) setRemovedSimIds((ids) => [...ids, row.id!]);
                        setSimDrafts((list) => list.filter((_, j) => j !== i));
                      }}
                      className="rounded p-1 text-slate-400 hover:text-red-600"
                      title="Убрать SIM"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-500">Номер</span>
                    <input
                      value={sim.sim_number}
                      onChange={(e) =>
                        setSimDrafts((list) =>
                          list.map((s, j) => (j === i ? { ...s, sim_number: e.target.value } : s)),
                        )
                      }
                      className={inputClass}
                      placeholder="89135001039"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-500">IP SIM</span>
                    <input
                      value={sim.sim_ip}
                      onChange={(e) =>
                        setSimDrafts((list) =>
                          list.map((s, j) => (j === i ? { ...s, sim_ip: e.target.value } : s)),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-slate-500">ICCID</span>
                    <input
                      value={sim.sim_iccid}
                      onChange={(e) =>
                        setSimDrafts((list) =>
                          list.map((s, j) => (j === i ? { ...s, sim_iccid: e.target.value } : s)),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                  <SecretField
                    label="PIN"
                    value={sim.sim_pin}
                    onChange={(v) =>
                      setSimDrafts((list) => list.map((s, j) => (j === i ? { ...s, sim_pin: v } : s)))
                    }
                  />
                  <SecretField
                    label="PUK"
                    value={sim.sim_puk}
                    onChange={(v) =>
                      setSimDrafts((list) => list.map((s, j) => (j === i ? { ...s, sim_puk: v } : s)))
                    }
                  />
                  <label className="block text-sm sm:col-span-2">
                    <span className="mb-1 block text-slate-500">Comment</span>
                    <input
                      value={sim.comment}
                      onChange={(e) =>
                        setSimDrafts((list) =>
                          list.map((s, j) => (j === i ? { ...s, comment: e.target.value } : s)),
                        )
                      }
                      className={inputClass}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
          {!editor.parent && !editor.entry?.parent_id && (
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Раздел (как ## Gateways)</span>
            <input
              value={form.section}
              onChange={(e) => setForm((s) => ({ ...s, section: e.target.value }))}
              className={inputClass}
              placeholder="пусто — основная таблица, либо Gateways"
            />
          </label>
          )}
        </div>
      )}
    </Modal>
  );
}
