import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getAuditSettings, patchAuditSettings } from "../../api/audit";
import { getNotificationSettings, patchNotificationSettings } from "../../api/notifications";
import { getTaskArchiveSettings, listSystems, updateTaskArchiveSettings } from "../../api/systems";
import { importTasksFromExcel } from "../../api/tasks";
import type { TaskExcelImportBatchOut } from "../../api/tasks";
import { importUsersFromExcel } from "../../api/users";
import { NeedPermission, toastInsufficientRights } from "../../components/NeedPermission";
import { useAuth } from "../../context/AuthContext";
import { PERM, hasPermission } from "../../lib/permissions";
import { toastApiError, toastError, toastSuccess } from "../../lib/toast";
import { useModalLayer } from "../../lib/useModalLayer";
import { useToastQueryError } from "../../lib/useToastQueryError";
import { AdminLock } from "./adminUi";
import { DatabaseBackupSection } from "./DatabaseBackupSection";
import {
  KnowledgeObsidianImportSection,
  UspdObsidianImportSection,
  UspdSimExcelImportSection,
  VacationExcelImportSection,
} from "./AdminImports";

export function SystemSettingsSection() {
  const { state } = useAuth();
  const currentUser = state.status === "authenticated" ? state.user : null;
  const canManageSettings = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_SETTINGS));
  const canManageBackups = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_BACKUPS));
  const canImportUsers = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_IMPORT_USERS));
  const canImportTasks = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_IMPORT_TASKS));
  const canImportVacations = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_IMPORT_VACATIONS));
  const canImportKnowledge = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_IMPORT_KNOWLEDGE));
  const canImportUspd = !!(currentUser && hasPermission(currentUser, PERM.ADMIN_IMPORT_USPD));
  const qc = useQueryClient();
  const [autoArchiveDays, setAutoArchiveDays] = useState("60");
  const [auditRetentionDays, setAuditRetentionDays] = useState("180");
  const [notifReadDays, setNotifReadDays] = useState("90");
  const [notifUnreadDays, setNotifUnreadDays] = useState("180");
  const [notifNoteDays, setNotifNoteDays] = useState("30");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResultOpen, setImportResultOpen] = useState(false);
  const [taskImportOpen, setTaskImportOpen] = useState(false);
  const [taskImportFiles, setTaskImportFiles] = useState<File[]>([]);
  const [taskImportSystemId, setTaskImportSystemId] = useState("");
  const [taskImportSheet, setTaskImportSheet] = useState("");
  const [taskImportResult, setTaskImportResult] = useState<TaskExcelImportBatchOut | null>(null);
  const taskArchiveQuery = useQuery({
    queryKey: ["admin", "task-archive-settings"],
    queryFn: getTaskArchiveSettings,
  });
  const auditSettingsQuery = useQuery({
    queryKey: ["admin", "audit-settings"],
    queryFn: getAuditSettings,
  });
  const notificationSettingsQuery = useQuery({
    queryKey: ["admin", "notification-settings"],
    queryFn: getNotificationSettings,
  });
  useToastQueryError(taskArchiveQuery.error, "Не удалось загрузить настройки автоархивации");
  useToastQueryError(auditSettingsQuery.error, "Не удалось загрузить настройки аудита");
  useToastQueryError(notificationSettingsQuery.error, "Не удалось загрузить настройки уведомлений");
  useEffect(() => {
    if (!taskArchiveQuery.data) return;
    setAutoArchiveDays(String(taskArchiveQuery.data.auto_archive_done_days));
  }, [taskArchiveQuery.data]);
  useEffect(() => {
    if (!auditSettingsQuery.data) return;
    setAuditRetentionDays(String(auditSettingsQuery.data.retention_days));
  }, [auditSettingsQuery.data]);
  useEffect(() => {
    if (!notificationSettingsQuery.data) return;
    setNotifReadDays(String(notificationSettingsQuery.data.read_days));
    setNotifUnreadDays(String(notificationSettingsQuery.data.unread_days));
    setNotifNoteDays(String(notificationSettingsQuery.data.note_reminder_days));
  }, [notificationSettingsQuery.data]);
  const taskArchiveMut = useMutation({
    mutationFn: (days: number) => updateTaskArchiveSettings(days),
    onSuccess: async (saved) => {
      setAutoArchiveDays(String(saved.auto_archive_done_days));
      toastSuccess("Период автоархивации сохранён");
      await qc.invalidateQueries({ queryKey: ["admin", "task-archive-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить период автоархивации"),
  });
  const auditSettingsMut = useMutation({
    mutationFn: (body: { enabled?: boolean; retention_days?: number }) => patchAuditSettings(body),
    onSuccess: async (saved) => {
      setAuditRetentionDays(String(saved.retention_days));
      toastSuccess("Настройки аудита сохранены");
      await qc.invalidateQueries({ queryKey: ["admin", "audit-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить настройки аудита"),
  });
  const notificationSettingsMut = useMutation({
    mutationFn: (body: {
      enabled?: boolean;
      read_days?: number;
      unread_days?: number;
      note_reminder_days?: number;
    }) => patchNotificationSettings(body),
    onSuccess: async (saved) => {
      setNotifReadDays(String(saved.read_days));
      setNotifUnreadDays(String(saved.unread_days));
      setNotifNoteDays(String(saved.note_reminder_days));
      toastSuccess("Настройки уведомлений сохранены");
      await qc.invalidateQueries({ queryKey: ["admin", "notification-settings"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось сохранить настройки уведомлений"),
  });
  const importUsersMut = useMutation({
    mutationFn: (file: File) => importUsersFromExcel(file),
    onSuccess: async () => {
      toastSuccess("Импорт сотрудников завершён");
      setImportResultOpen(true);
      setImportFile(null);
      await qc.invalidateQueries({ queryKey: ["admin", "users"] });
      await qc.invalidateQueries({ queryKey: ["users", "assignee-candidates"] });
      await qc.invalidateQueries({ queryKey: ["employee-directory"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать сотрудников"),
  });

  const systemsForImportQuery = useQuery({
    queryKey: ["systems", "task-import"],
    queryFn: () => listSystems(true),
    enabled: taskImportOpen,
  });

  const importTasksMut = useMutation({
    mutationFn: () => {
      if (!taskImportFiles.length) {
        return Promise.reject(new Error("Выберите файл(ы)"));
      }
      if (taskImportFiles.length === 1 && !taskImportSystemId) {
        // система опциональна — бэкенд попробует сопоставить сам
      }
      return importTasksFromExcel({
        files: taskImportFiles,
        systemId: taskImportFiles.length === 1 ? taskImportSystemId || undefined : undefined,
        sheetName: taskImportSheet || undefined,
      });
    },
    onSuccess: async (data) => {
      setTaskImportResult(data);
      toastSuccess(
        `Файлов: ${data.files_ok}/${data.files_total}, задач создано: ${data.created_total}` +
          (data.files_failed ? `, ошибок: ${data.files_failed}` : ""),
      );
      setTaskImportFiles([]);
      setTaskImportOpen(false);
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: unknown) => toastApiError(e, "Не удалось импортировать задачи"),
  });

  const { backdropProps: taskImportBackdrop, stopPanelPointer: taskImportPanelStop } = useModalLayer(
    taskImportOpen,
    () => {
      if (!importTasksMut.isPending) setTaskImportOpen(false);
    },
    {
      closeOnBackdrop: !importTasksMut.isPending,
      closeOnEscape: !importTasksMut.isPending,
    },
  );

  return (
    <div className="space-y-6">
      <AdminLock
        allowed={canManageSettings}
        hint="Нет права менять настройки — блоки можно смотреть, кнопки сохранения недоступны."
      >
        <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Автоархивация выполненных задач</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Задачи в колонке «выполнено» автоматически переходят в архив после указанного периода.
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canManageSettings) {
              toastInsufficientRights();
              return;
            }
            const parsed = Number(autoArchiveDays);
            if (!Number.isFinite(parsed) || parsed < 1) {
              toastError("Введите число дней от 1");
              return;
            }
            taskArchiveMut.mutate(Math.floor(parsed));
          }}
        >
          <label className="text-sm text-slate-700 dark:text-slate-300">
            Период (дней)
            <input
              type="number"
              min={1}
              max={3650}
              value={autoArchiveDays}
              onChange={(e) => setAutoArchiveDays(e.target.value)}
              disabled={taskArchiveQuery.isPending || taskArchiveMut.isPending}
              className="ml-2 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <NeedPermission allowed={canManageSettings}>
            <button
              type="submit"
              disabled={taskArchiveQuery.isPending || taskArchiveMut.isPending}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
            >
              {taskArchiveMut.isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </NeedPermission>
        </form>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Аудит действий</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Управление настройками аудита по системе: можно отключить запись и настроить срок хранения.
        </p>
        <div className="mt-4 space-y-3">
          <NeedPermission allowed={canManageSettings} className="flex">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={auditSettingsQuery.data?.enabled ?? true}
                disabled={auditSettingsQuery.isPending || auditSettingsMut.isPending}
                onChange={(e) => auditSettingsMut.mutate({ enabled: e.target.checked })}
              />
              Включить аудит
            </label>
          </NeedPermission>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canManageSettings) {
                toastInsufficientRights();
                return;
              }
              const parsed = Number(auditRetentionDays);
              if (!Number.isFinite(parsed) || parsed < 7) {
                toastError("Введите число дней от 7");
                return;
              }
              auditSettingsMut.mutate({ retention_days: Math.floor(parsed) });
            }}
          >
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Срок хранения (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={auditRetentionDays}
                onChange={(e) => setAuditRetentionDays(e.target.value)}
                disabled={auditSettingsQuery.isPending || auditSettingsMut.isPending}
                className="ml-2 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <NeedPermission allowed={canManageSettings}>
              <button
                type="submit"
                disabled={auditSettingsQuery.isPending || auditSettingsMut.isPending}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
              >
                {auditSettingsMut.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </NeedPermission>
          </form>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Хранение уведомлений</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Ротация старых уведомлений. Прочитанные удаляются раньше непрочитанных. Напоминания по личным
          заметкам хранятся отдельно — ежедневные копятся быстрее.
        </p>
        <div className="mt-4 space-y-3">
          <NeedPermission allowed={canManageSettings} className="flex">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={notificationSettingsQuery.data?.enabled ?? true}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                onChange={(e) => notificationSettingsMut.mutate({ enabled: e.target.checked })}
              />
              Включить ротацию
            </label>
          </NeedPermission>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canManageSettings) {
                toastInsufficientRights();
                return;
              }
              const readDays = Number(notifReadDays);
              const unreadDays = Number(notifUnreadDays);
              const noteDays = Number(notifNoteDays);
              if (
                ![readDays, unreadDays, noteDays].every((n) => Number.isFinite(n) && n >= 7)
              ) {
                toastError("Введите число дней от 7");
                return;
              }
              notificationSettingsMut.mutate({
                read_days: Math.floor(readDays),
                unread_days: Math.floor(unreadDays),
                note_reminder_days: Math.floor(noteDays),
              });
            }}
          >
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Прочитанные (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={notifReadDays}
                onChange={(e) => setNotifReadDays(e.target.value)}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Непрочитанные (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={notifUnreadDays}
                onChange={(e) => setNotifUnreadDays(e.target.value)}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Напоминания по заметкам (дней)
              <input
                type="number"
                min={7}
                max={3650}
                value={notifNoteDays}
                onChange={(e) => setNotifNoteDays(e.target.value)}
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="ml-2 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <NeedPermission allowed={canManageSettings}>
              <button
                type="submit"
                disabled={notificationSettingsQuery.isPending || notificationSettingsMut.isPending}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
              >
                {notificationSettingsMut.isPending ? "Сохранение…" : "Сохранить"}
              </button>
            </NeedPermission>
          </form>
        </div>
      </div>
        </div>
      </AdminLock>
      <AdminLock
        allowed={canManageBackups}
        hint="Нет права на резервные копии — список можно смотреть, создание и скачивание недоступны."
      >
        <DatabaseBackupSection allowed={canManageBackups} />
      </AdminLock>
      <AdminLock
        allowed={canImportUspd}
        hint="Нет права импорта УСПД — форму можно смотреть, импорт недоступен."
      >
        <div className="space-y-6">
          <UspdObsidianImportSection allowed={canImportUspd} />
          <UspdSimExcelImportSection allowed={canImportUspd} />
        </div>
      </AdminLock>
      <AdminLock
        allowed={canImportKnowledge}
        hint="Нет права импорта базы знаний — форму можно смотреть, импорт недоступен."
      >
        <KnowledgeObsidianImportSection allowed={canImportKnowledge} />
      </AdminLock>
      <AdminLock
        allowed={canImportUsers}
        hint="Нет права импорта сотрудников — форму можно смотреть, импорт недоступен."
      >
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт сотрудников из Excel</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Файл `.xlsx`, первый лист. Обязательные колонки: «УчетнаяЗапись», «ФИО», «Должность». Дополнительно:
            «Подразделение», «Системы» (несколько через запятую). Скачайте шаблон, заполните и загрузите его сюда.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                try {
                  const { downloadEmployeeImportTemplate } = await import("../../lib/exportEmployeeImportTemplate");
                  await downloadEmployeeImportTemplate();
                  toastSuccess("Шаблон Excel скачан");
                } catch (e: unknown) {
                  toastApiError(e, "Не удалось сформировать шаблон");
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              Скачать шаблон
            </button>
          </div>
          <form
            className="mt-3 flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canImportUsers) {
                toastInsufficientRights();
                return;
              }
              if (!importFile) {
                toastError("Выберите файл Excel");
                return;
              }
              importUsersMut.mutate(importFile);
            }}
          >
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              disabled={importUsersMut.isPending}
              className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <NeedPermission allowed={canImportUsers}>
              <button
                type="submit"
                disabled={importUsersMut.isPending || !importFile}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-sky-600 disabled:opacity-60"
              >
                {importUsersMut.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Импорт…
                  </>
                ) : (
                  "Импортировать"
                )}
              </button>
            </NeedPermission>
          </form>

          {importUsersMut.data && importResultOpen && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
              <p className="font-medium text-slate-900 dark:text-white">
                Результат: создано {importUsersMut.data.created}, обновлено {importUsersMut.data.updated}, пропущено{" "}
                {importUsersMut.data.skipped}.
              </p>
              <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100/90 dark:bg-slate-800/90">
                    <tr>
                      <th className="px-2 py-1.5">Строка</th>
                      <th className="px-2 py-1.5">Логин</th>
                      <th className="px-2 py-1.5">Статус</th>
                      <th className="px-2 py-1.5">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {importUsersMut.data.rows.map((row) => (
                      <tr key={`${row.sheet_row}-${row.login ?? "empty"}`}>
                        <td className="px-2 py-1.5">{row.sheet_row}</td>
                        <td className="px-2 py-1.5">{row.login ?? "—"}</td>
                        <td className="px-2 py-1.5">{row.status}</td>
                        <td className="px-2 py-1.5">{row.message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => setImportResultOpen(false)}
                className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Скрыть детали
              </button>
            </div>
          )}
        </div>
      </AdminLock>

      <AdminLock
        allowed={canImportVacations}
        hint="Нет права импорта отпусков — форму можно смотреть, импорт недоступен."
      >
        <VacationExcelImportSection allowed={canImportVacations} />
      </AdminLock>

      <AdminLock
        allowed={canImportTasks}
        hint="Нет права импорта задач — форму можно смотреть, импорт недоступен."
      >
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-900/60">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Импорт задач из задачника Excel</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Можно загрузить <strong>несколько файлов</strong> сразу (по одному на систему). Система определяется по
          имени файла/листа (например «Задачник СМЗиС.xlsx» → СМЗиС).
        </p>
        <NeedPermission allowed={canImportTasks}>
          <button
            type="button"
            onClick={() => {
              setTaskImportResult(null);
              setTaskImportFiles([]);
              setTaskImportSystemId("");
              setTaskImportOpen(true);
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-emerald-400 hover:via-teal-400 hover:to-cyan-500"
          >
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
            Из Excel…
          </button>
        </NeedPermission>
        {taskImportResult && (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
            <p className="font-medium text-slate-900 dark:text-white">
              Итого: файлов ок {taskImportResult.files_ok}/{taskImportResult.files_total}, создано задач{" "}
              {taskImportResult.created_total}, предупреждений {taskImportResult.warnings_total}
              {taskImportResult.files_failed ? `, ошибок файлов ${taskImportResult.files_failed}` : ""}.
            </p>
            {taskImportResult.files.map((f) => (
              <div
                key={f.filename}
                className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/60"
              >
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  {f.filename}
                  {f.ok && f.result
                    ? ` → ${f.result.system_name} (лист «${f.result.sheet_name}», +${f.result.created})`
                    : null}
                  {!f.ok ? (
                    <span className="font-normal text-red-600 dark:text-red-400"> — {f.error}</span>
                  ) : null}
                </p>
                {f.ok && f.result && f.result.rows.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100/90 dark:bg-slate-800/90">
                        <tr>
                          <th className="px-2 py-1">Строка</th>
                          <th className="px-2 py-1">Задача</th>
                          <th className="px-2 py-1">Статус</th>
                          <th className="px-2 py-1">Комментарий</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {f.result.rows.map((row) => (
                          <tr key={`${f.filename}-${row.row}-${row.task_id ?? row.title}`}>
                            <td className="px-2 py-1">{row.row}</td>
                            <td className="px-2 py-1">{row.title}</td>
                            <td className="px-2 py-1">{row.status}</td>
                            <td className="px-2 py-1">{row.message ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setTaskImportResult(null)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              Скрыть детали
            </button>
          </div>
        )}
      </div>
      </AdminLock>

      {taskImportOpen && (
        <div
          {...taskImportBackdrop}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
        >
          <div
            className="modal-panel w-full max-w-md overflow-hidden rounded-2xl border border-emerald-200/60 shadow-2xl dark:border-emerald-900/40"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-import-title"
            onClick={taskImportPanelStop}
          >
            <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 dark:border-emerald-900/50 dark:from-emerald-950/50 dark:to-teal-950/40">
              <h2
                id="task-import-title"
                className="flex items-center gap-2 text-lg font-semibold text-emerald-950 dark:text-emerald-100"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden />
                </span>
                Импорт задачников
              </h2>
              <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                Выберите один или несколько .xlsx — система подставится по имени файла/листа.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-sm text-slate-700 dark:text-slate-200">
                Файлы .xlsx
                <input
                  key={taskImportFiles.map((f) => f.name).join("|") || "task-empty"}
                  type="file"
                  multiple
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="mt-1.5 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-emerald-900 dark:text-slate-300 dark:file:bg-emerald-900/40 dark:file:text-emerald-100"
                  onChange={(e) => setTaskImportFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {taskImportFiles.length > 0 && (
                <ul className="max-h-28 list-inside list-disc overflow-auto text-xs text-slate-600 dark:text-slate-300">
                  {taskImportFiles.map((f) => (
                    <li key={f.name + f.size}>{f.name}</li>
                  ))}
                </ul>
              )}
              {taskImportFiles.length === 1 && (
                <label className="block text-sm text-slate-700 dark:text-slate-200">
                  Система (если авто-определение не сработает)
                  <select
                    value={taskImportSystemId}
                    onChange={(e) => setTaskImportSystemId(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  >
                    <option value="">— авто по имени файла/листа —</option>
                    {(systemsForImportQuery.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm text-slate-700 dark:text-slate-200">
                Лист (необязательно, для всех файлов)
                <input
                  value={taskImportSheet}
                  onChange={(e) => setTaskImportSheet(e.target.value)}
                  placeholder="Иначе первый лист с данными в каждом файле"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => !importTasksMut.isPending && setTaskImportOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Отмена
              </button>
              <NeedPermission allowed={canImportTasks}>
              <button
                type="button"
                disabled={!taskImportFiles.length || importTasksMut.isPending}
                onClick={() => importTasksMut.mutate()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md disabled:opacity-50"
              >
                {importTasksMut.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загрузка…
                  </>
                ) : (
                  `Импортировать (${taskImportFiles.length || 0})`
                )}
              </button>
              </NeedPermission>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
