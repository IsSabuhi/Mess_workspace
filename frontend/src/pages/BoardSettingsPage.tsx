import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { deleteBoard, listBoardAudit, listBoardMembers, listBoards, replaceBoardMembers, updateBoard } from "../api/boards";
import { listAssigneeCandidates } from "../api/users";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { canManageBoardColumns } from "../lib/permissions";
import { toastApiError, toastSuccess } from "../lib/toast";

const ROLE_LABEL: Record<"viewer" | "editor" | "manager", string> = {
  viewer: "Наблюдатель",
  editor: "Редактор",
  manager: "Менеджер",
};

export function BoardSettingsPage() {
  const { boardId = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { state } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;

  const [tab, setTab] = useState<"members" | "general" | "audit">("members");
  const [search, setSearch] = useState("");
  const [membersDraft, setMembersDraft] = useState<Array<{ user_id: string; role: "viewer" | "editor" | "manager" }>>([]);
  const [editBoardName, setEditBoardName] = useState("");

  const boardsQuery = useQuery({ queryKey: ["boards"], queryFn: listBoards, enabled: !!user });
  const assigneeQuery = useQuery({
    queryKey: ["users", "assignee-candidates", user?.id],
    queryFn: listAssigneeCandidates,
    enabled: !!user,
  });
  const membersQuery = useQuery({
    queryKey: ["board-members", boardId],
    queryFn: () => listBoardMembers(boardId),
    enabled: !!(boardId && user),
  });
  const auditQuery = useQuery({
    queryKey: ["board-audit", boardId],
    queryFn: () => listBoardAudit(boardId),
    enabled: !!(boardId && user && tab === "audit"),
  });

  const board = useMemo(() => (boardsQuery.data ?? []).find((b) => b.id === boardId) ?? null, [boardsQuery.data, boardId]);
  const currentRole = useMemo(() => {
    if (!user) return null;
    return (membersQuery.data ?? []).find((m) => m.user_id === user.id)?.role ?? null;
  }, [membersQuery.data, user]);
  const canManageByGlobal = !!(user && canManageBoardColumns(user));
  const canManageSettings = !!(user && board?.scope === "system" && (canManageByGlobal || currentRole === "manager"));

  useEffect(() => {
    if (!board) return;
    setEditBoardName(board.name);
  }, [board]);

  useEffect(() => {
    setMembersDraft((membersQuery.data ?? []).map((m) => ({ user_id: m.user_id, role: m.role })));
    setSearch("");
  }, [membersQuery.data]);

  const saveMembersMut = useMutation({
    mutationFn: (rows: Array<{ user_id: string; role: "viewer" | "editor" | "manager" }>) => replaceBoardMembers(boardId, rows),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["board-members", boardId] });
      toastSuccess("Участники доски обновлены");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось обновить участников доски"),
  });
  const updateBoardMut = useMutation({
    mutationFn: (name: string) => updateBoard(boardId, { name }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["boards"] });
      toastSuccess("Настройки доски сохранены");
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось обновить доску"),
  });
  const deleteBoardMut = useMutation({
    mutationFn: () => deleteBoard(boardId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["boards"] });
      toastSuccess("Доска удалена");
      nav("/tasks", { replace: true });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить доску"),
  });

  const candidates = useMemo(() => {
    const all = (assigneeQuery.data ?? []).map((u) => ({ id: u.id, full_name: u.full_name }));
    const selected = new Set(membersDraft.map((m) => m.user_id));
    const q = search.trim().toLowerCase();
    return all.filter((u) => !selected.has(u.id) && (!q || u.full_name.toLowerCase().includes(q)));
  }, [assigneeQuery.data, membersDraft, search]);
  const existing = useMemo(() => {
    const byId = new Map((assigneeQuery.data ?? []).map((u) => [u.id, u.full_name]));
    const q = search.trim().toLowerCase();
    return membersDraft
      .filter((m) => !q || (byId.get(m.user_id) ?? m.user_id).toLowerCase().includes(q))
      .map((m) => ({ ...m, name: byId.get(m.user_id) ?? m.user_id }));
  }, [assigneeQuery.data, membersDraft, search]);

  if (state.status !== "authenticated") return <Navigate to="/login" replace />;
  if (!board) return <AppShell title="Настройки доски"><p className="text-slate-500">Доска не найдена.</p></AppShell>;
  if (board.scope !== "system") return <AppShell title="Настройки доски"><p className="text-slate-500">Настройки доступны только для системных досок.</p></AppShell>;
  if (!canManageSettings) return <AppShell title="Настройки доски"><p className="text-slate-500">Недостаточно прав.</p></AppShell>;

  return (
    <AppShell title="Настройки доски" subtitle={board.name} wide>
      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-1.5 dark:border-slate-700 dark:bg-slate-900/50">
        {(["members", "general", "audit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? "bg-sky-500 text-white shadow-md"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {t === "members" ? "Участники" : t === "general" ? "Общие" : "Аудит"}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <div className="space-y-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по ФИО" className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
          <div className="rounded-xl border border-slate-200 dark:border-slate-700">
            {existing.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 dark:border-slate-800">
                <button type="button" onClick={() => setMembersDraft((p) => p.filter((x) => x.user_id !== m.user_id))} className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">Удалить</button>
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <select value={m.role} onChange={(e) => setMembersDraft((p) => p.map((x) => (x.user_id === m.user_id ? { ...x, role: e.target.value as "viewer" | "editor" | "manager" } : x)))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800">
                  <option value="viewer">{ROLE_LABEL.viewer}</option>
                  <option value="editor">{ROLE_LABEL.editor}</option>
                  <option value="manager">{ROLE_LABEL.manager}</option>
                </select>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700">
            {candidates.map((u) => (
              <div key={u.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 dark:border-slate-800">
                <button type="button" onClick={() => setMembersDraft((p) => [...p, { user_id: u.id, role: "viewer" }])} className="rounded px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30">Добавить</button>
                <span className="min-w-0 flex-1 truncate">{u.full_name}</span>
              </div>
            ))}
          </div>
          <button type="button" disabled={saveMembersMut.isPending} onClick={() => saveMembersMut.mutate(membersDraft)} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60">{saveMembersMut.isPending ? "Сохранение…" : "Сохранить участников"}</button>
        </div>
      )}

      {tab === "general" && (
        <div className="max-w-2xl space-y-6">
          <section className="space-y-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Редактирование</p>
            <input value={editBoardName} onChange={(e) => setEditBoardName(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
            <button type="button" disabled={updateBoardMut.isPending || !editBoardName.trim()} onClick={() => updateBoardMut.mutate(editBoardName.trim())} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60">{updateBoardMut.isPending ? "Сохранение…" : "Сохранить изменения"}</button>
          </section>

          <section className="rounded-xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/60 dark:bg-red-950/20">
            <p className="mb-2 text-sm font-medium text-red-800 dark:text-red-300">Удаление</p>
            <p className="text-sm text-red-800 dark:text-red-300">Удаление доски удалит все ее колонки и задачи без возможности восстановления.</p>
            <button type="button" disabled={deleteBoardMut.isPending} onClick={() => deleteBoardMut.mutate()} className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50">{deleteBoardMut.isPending ? "Удаление…" : "Удалить доску"}</button>
          </section>
        </div>
      )}

      {tab === "audit" && (
        <div className="max-w-3xl space-y-2">
          {(auditQuery.data ?? []).map((ev) => (
            <div key={ev.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/50">
              <p className="font-medium text-slate-700 dark:text-slate-200">{ev.action}</p>
              <p className="text-slate-500 dark:text-slate-400">{ev.actor_name ?? "Система"} • {new Date(ev.created_at).toLocaleString("ru-RU")}</p>
            </div>
          ))}
          {!auditQuery.isPending && (auditQuery.data ?? []).length === 0 && <p className="text-sm text-slate-500">Событий пока нет.</p>}
        </div>
      )}
    </AppShell>
  );
}
