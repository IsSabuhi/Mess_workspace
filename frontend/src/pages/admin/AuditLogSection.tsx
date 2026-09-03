import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { listAuditEvents } from "../../api/audit";
import { listUsers } from "../../api/users";
import { AUDIT_ACTION_LABELS, auditActionLabel, formatAuditDetails } from "../../lib/auditFormat";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useToastQueryError } from "../../lib/useToastQueryError";

export function AuditLogSection() {
  const [auditFilterEntityType, setAuditFilterEntityType] = useState("");
  const [auditFilterAction, setAuditFilterAction] = useState("");
  const [auditFilterQuery, setAuditFilterQuery] = useState("");
  /** "" = все, "__system__" = без автора, иначе UUID пользователя */
  const [auditFilterActor, setAuditFilterActor] = useState("");
  const [auditFilterActorQ, setAuditFilterActorQ] = useState("");
  const debouncedEntityType = useDebouncedValue(auditFilterEntityType, 300);
  const debouncedAction = useDebouncedValue(auditFilterAction, 300);
  const debouncedQuery = useDebouncedValue(auditFilterQuery, 300);
  const debouncedActorQ = useDebouncedValue(auditFilterActorQ, 300);

  const usersQuery = useQuery({
    queryKey: ["admin", "users", "audit-filter"],
    queryFn: () => listUsers({ limit: 500, offset: 0 }),
  });
  const actorUsers = useMemo(() => {
    const rows = usersQuery.data?.items ?? [];
    return [...rows].sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
  }, [usersQuery.data]);

  const auditEventsQuery = useQuery({
    queryKey: [
      "admin",
      "audit-events",
      debouncedEntityType,
      debouncedAction,
      debouncedQuery,
      auditFilterActor,
      debouncedActorQ,
    ],
    queryFn: () =>
      listAuditEvents({
        limit: 200,
        entity_type: debouncedEntityType.trim() || undefined,
        action: debouncedAction.trim() || undefined,
        q: debouncedQuery.trim() || undefined,
        actor_user_id:
          auditFilterActor && auditFilterActor !== "__system__" ? auditFilterActor : undefined,
        system_only: auditFilterActor === "__system__" || undefined,
        actor_q: debouncedActorQ.trim() || undefined,
      }),
  });
  useToastQueryError(auditEventsQuery.error, "Не удалось загрузить журнал аудита");

  const hasAuditFilters =
    !!auditFilterEntityType.trim() ||
    !!auditFilterAction.trim() ||
    !!auditFilterQuery.trim() ||
    !!auditFilterActor ||
    !!auditFilterActorQ.trim();

  return (
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="shrink-0 text-base font-semibold text-slate-900 dark:text-white">Журнал аудита</h3>
      <p className="mt-1 shrink-0 text-sm text-slate-600 dark:text-slate-400">
        Общий журнал событий по системе. Используйте фильтры для поиска нужных действий и пользователей.
      </p>
      <div className="mt-4 mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <input
          value={auditFilterEntityType}
          onChange={(e) => setAuditFilterEntityType(e.target.value)}
          placeholder="Тип сущности (например board)"
          className="w-52 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={auditFilterAction}
          onChange={(e) => setAuditFilterAction(e.target.value)}
          placeholder="Действие: Вход в систему или auth.login"
          list="audit-action-labels"
          className="w-72 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <datalist id="audit-action-labels">
          {Object.entries(AUDIT_ACTION_LABELS).map(([code, label]) => (
            <option key={code} value={label}>
              {code}
            </option>
          ))}
        </datalist>
        <select
          value={auditFilterActor}
          onChange={(e) => setAuditFilterActor(e.target.value)}
          className="min-w-[14rem] max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          title="Фильтр по столбцу «Кто»"
        >
          <option value="">Кто: все</option>
          <option value="__system__">Кто: Система</option>
          {actorUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({u.email})
            </option>
          ))}
        </select>
        <input
          value={auditFilterActorQ}
          onChange={(e) => setAuditFilterActorQ(e.target.value)}
          placeholder="Кто: поиск по ФИО / email"
          className="w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={auditFilterQuery}
          onChange={(e) => setAuditFilterQuery(e.target.value)}
          placeholder="Поиск по действию/деталям"
          className="min-w-[14rem] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        {hasAuditFilters && (
          <button
            type="button"
            onClick={() => {
              setAuditFilterEntityType("");
              setAuditFilterAction("");
              setAuditFilterQuery("");
              setAuditFilterActor("");
              setAuditFilterActorQ("");
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Сбросить
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Время</th>
              <th className="px-3 py-2">Сущность</th>
              <th className="px-3 py-2">Действие</th>
              <th className="px-3 py-2">Кто</th>
              <th className="px-3 py-2">Детали</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {(auditEventsQuery.data ?? []).map((ev) => (
              <tr key={ev.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                  {new Date(ev.created_at).toLocaleString("ru-RU")}
                </td>
                <td className="px-3 py-2 text-xs">
                  {ev.entity_type}
                  {ev.entity_id ? `:${String(ev.entity_id).slice(0, 8)}` : ""}
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800 dark:text-slate-100">{auditActionLabel(ev.action)}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">{ev.action}</p>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{ev.actor_name ?? "Система"}</td>
                <td className="max-w-md px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                  {formatAuditDetails(ev.action, ev.details_json)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!auditEventsQuery.isPending && (auditEventsQuery.data ?? []).length === 0 && (
          <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">Событий аудита по фильтрам не найдено.</p>
        )}
        {auditEventsQuery.isPending && (
          <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">Загрузка журнала аудита…</p>
        )}
      </div>
    </div>
  );
}
