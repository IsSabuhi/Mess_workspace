import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deleteSystemBackup,
  downloadSystemBackup,
  getBackupSettings,
  listSystemBackups,
  patchBackupSettings,
  requestSystemBackup,
} from "../../api/backups";
import { NeedPermission, toastInsufficientRights } from "../../components/NeedPermission";
import { toastApiError, toastError, toastSuccess } from "../../lib/toast";
import { useToastQueryError } from "../../lib/useToastQueryError";

function formatBackupSize(n: number | null): string {
  if (n == null || n < 0) return "—";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

function backupStatusLabel(status: string): string {
  if (status === "pending") return "В очереди";
  if (status === "running") return "Создаётся…";
  if (status === "completed") return "Готов";
  if (status === "failed") return "Ошибка";
  return status;
}

function backupSourceOf(row: { source?: string; created_by_id?: string | null }): "manual" | "scheduled" {
  if (row.source === "scheduled" || row.source === "manual") return row.source;
  return row.created_by_id ? "manual" : "scheduled";
}

function formatBackupWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU");
}

export function DatabaseBackupSection({ allowed }: { allowed: boolean }) {
  const qc = useQueryClient();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState("10");
  const [backupTime, setBackupTime] = useState("03:00");
  const backupsQuery = useQuery({
    queryKey: ["admin", "system-backups"],
    queryFn: listSystemBackups,
    refetchInterval: (q) => {
      const rows = q.state.data;
      if (rows?.some((r) => r.status === "pending" || r.status === "running")) return 2500;
      return 15_000;
    },
  });
  const settingsQuery = useQuery({
    queryKey: ["admin", "backup-settings"],
    queryFn: getBackupSettings,
  });
  useToastQueryError(backupsQuery.error, "Не удалось загрузить список резервных копий");
  useToastQueryError(settingsQuery.error, "Не удалось загрузить настройки резервных копий");
  useEffect(() => {
    if (!settingsQuery.data) return;
    setRetentionDays(String(settingsQuery.data.retention_days));
    setBackupTime(settingsQuery.data.run_at || "03:00");
  }, [settingsQuery.data]);
  const createMut = useMutation({
    mutationFn: requestSystemBackup,
    onSuccess: async () => {
      toastSuccess("Дамп поставлен в очередь. Обычно занимает от нескольких секунд до нескольких минут.");
      await qc.invalidateQueries({ queryKey: ["admin", "system-backups"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось запустить резервное копирование"),
  });
  const deleteMut = useMutation({
    mutationFn: deleteSystemBackup,
    onSuccess: async () => {
      toastSuccess("Резервная копия удалена");
      await qc.invalidateQueries({ queryKey: ["admin", "system-backups"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось удалить резервную копию"),
  });
  const settingsMut = useMutation({
    mutationFn: (body: { enabled?: boolean; retention_days?: number; run_at?: string }) =>
      patchBackupSettings(body),
    onSuccess: async (saved) => {
      setRetentionDays(String(saved.retention_days));
      setBackupTime(saved.run_at);
      toastSuccess("Настройки резервных копий сохранены");
      await qc.invalidateQueries({ queryKey: ["admin", "backup-settings"] });
      await qc.invalidateQueries({ queryKey: ["admin", "system-backups"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить настройки резервных копий"),
  });
  const rows = backupsQuery.data ?? [];
  const busy = rows.some((r) => r.status === "pending" || r.status === "running");
  const settings = settingsQuery.data;
  const lastScheduled = rows.find((r) => backupSourceOf(r) === "scheduled") ?? null;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
        <Database className="h-4 w-4 shrink-0" aria-hidden />
        Резервные копии базы данных
      </h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Полный дамп PostgreSQL (формат pg_dump custom). Картинки базы знаний
        и вложения в дамп не входят.
      </p>
      <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-800/40">
        <NeedPermission allowed={allowed} className="flex">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={settings?.enabled ?? true}
              disabled={settingsQuery.isPending || settingsMut.isPending}
              onChange={(e) => settingsMut.mutate({ enabled: e.target.checked })}
            />
            Ежедневный автоматический бэкап
          </label>
        </NeedPermission>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Один успешный автоматический дамп в сутки. Если воркер пропустил время — догонит позже в тот же день. 24-часовой формат по
          UTC+7.
        </p>
        {lastScheduled && (
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Последний по расписанию: {backupStatusLabel(lastScheduled.status).toLowerCase()}
            {lastScheduled.finished_at
              ? ` · выполнен ${formatBackupWhen(lastScheduled.finished_at)}`
              : ` · запущен ${formatBackupWhen(lastScheduled.created_at)}`}
            {lastScheduled.status === "failed" && lastScheduled.error_message
              ? ` — ${lastScheduled.error_message}`
              : ""}
          </p>
        )}
        {!lastScheduled && !backupsQuery.isPending && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Автоматических копий пока нет — первая появится после ближайшего запуска по расписанию.
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!allowed) {
              toastInsufficientRights();
              return;
            }
            const days = Number(retentionDays);
            const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(backupTime.trim());
            if (!Number.isFinite(days) || days < 1 || days > 365) {
              toastError("Срок хранения: от 1 до 365 дней");
              return;
            }
            if (!match) {
              toastError("Укажите время в формате ЧЧ:ММ, например 07:00 или 19:30");
              return;
            }
            settingsMut.mutate({
              retention_days: Math.floor(days),
              run_at: `${match[1].padStart(2, "0")}:${match[2]}`,
            });
          }}
        >
          <label className="text-sm text-slate-700 dark:text-slate-300">
            Хранить (дней)
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              disabled={settingsQuery.isPending || settingsMut.isPending}
              className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="text-sm text-slate-700 dark:text-slate-300">
            Время запуска
            <input
              type="time"
              lang="ru"
              step={60}
              value={backupTime}
              onChange={(e) => setBackupTime(e.target.value)}
              disabled={settingsQuery.isPending || settingsMut.isPending}
              className="ml-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <NeedPermission allowed={allowed}>
            <button
              type="submit"
              disabled={settingsQuery.isPending || settingsMut.isPending}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
            >
              {settingsMut.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </NeedPermission>
        </form>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Место на диске ≈ число дней × размер одного дампа
          {settings?.estimated_bytes != null
            ? ` (сейчас около ${formatBackupSize(settings.estimated_bytes)})`
            : " — оценка появится после первого успешного дампа"}
          . Ручные копии за эти дни тоже занимают место. Старые удаляются автоматически.
        </p>
      </div>
      <div className="mt-4">
        <NeedPermission allowed={allowed}>
          <button
            type="button"
            disabled={createMut.isPending || busy}
            onClick={() => createMut.mutate()}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
          >
            {createMut.isPending || busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {busy ? "Идёт создание…" : "Запуск…"}
              </>
            ) : (
              "Создать резервную копию"
            )}
          </button>
        </NeedPermission>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Файл</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Создан</th>
              <th className="px-3 py-2">Размер</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {backupsQuery.isPending && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-500">
                  Загрузка…
                </td>
              </tr>
            )}
            {!backupsQuery.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-slate-500">
                  Пока нет резервных копий
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const source = backupSourceOf(row);
              return (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">
                  <div>{row.filename}</div>
                  {source === "manual" && row.created_by_name && (
                    <div className="text-xs font-normal text-slate-500">{row.created_by_name}</div>
                  )}
                  {row.status === "failed" && row.error_message && (
                    <div className="mt-1 max-w-md text-xs font-normal text-rose-600 dark:text-rose-400">
                      {row.error_message}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      source === "scheduled"
                        ? "inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
                        : "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }
                  >
                    {source === "scheduled" ? "По расписанию" : "Вручную"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                  {formatBackupWhen(row.created_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                  {formatBackupSize(row.size_bytes)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div
                    className={
                      row.status === "completed"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : row.status === "failed"
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-sky-700 dark:text-sky-400"
                    }
                  >
                    {backupStatusLabel(row.status)}
                  </div>
                  {row.finished_at && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatBackupWhen(row.finished_at)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <NeedPermission allowed={allowed}>
                    <button
                      type="button"
                      disabled={row.status !== "completed" || downloadingId === row.id}
                      onClick={async () => {
                        setDownloadingId(row.id);
                        try {
                          await downloadSystemBackup(row.id, row.filename);
                          toastSuccess("Файл скачан");
                        } catch (e: unknown) {
                          toastApiError(e, "Не удалось скачать дамп");
                        } finally {
                          setDownloadingId(null);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {downloadingId === row.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Скачать
                    </button>
                    </NeedPermission>
                    <NeedPermission allowed={allowed}>
                    <button
                      type="button"
                      disabled={
                        deleteMut.isPending || row.status === "pending" || row.status === "running"
                      }
                      onClick={() => {
                        if (!window.confirm(`Удалить ${row.filename}?`)) return;
                        deleteMut.mutate(row.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-slate-800 dark:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Удалить
                    </button>
                    </NeedPermission>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        <p className="font-medium text-slate-800 dark:text-slate-200">Как восстановить на новой установке</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          <li>Поднимите Postgres, создайте пустую базу. Api и worker пока не запускайте (или остановите).</li>
          <li>
            Положите скачанный <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">.dump</code> на
            сервер. Если дамп уже на сервере — том Docker <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">backup_data</code>{" "}
            монтируется в <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">/backups</code>.
          </li>
          <li>
            Восстановление:{" "}
            <code className="break-all rounded bg-slate-200 px-1 dark:bg-slate-700">
              docker compose --profile jobs run --rm api-job scripts/restore_database_backup.py /backups/файл.dump
              --clean
            </code>
          </li>
          <li>Запустите api и worker. Миграции Alembic догонят схему, если дамп чуть старше.</li>
        </ol>
        <p className="mt-2">
          Из интерфейса восстановление специально не делается: команда затирает живую базу. Флаг{" "}
          <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">--clean</code> нужен, если в базе уже есть
          таблицы.
        </p>
      </div>
    </div>
  );
}
