import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "../api/client";
import type { EmployeeDirectoryRowOut, EmployeeGender, WorkScheduleKind } from "../api/employeeDirectory";
import { getEmployeeDirectoryUser } from "../api/employeeDirectory";
import { useModalLayer } from "../lib/useModalLayer";

function workScheduleLabel(kind: WorkScheduleKind, gender: EmployeeGender): string {
  if (kind === "shift") return "Сменный (11-3-8)";
  if (kind === "two_two") return "2/2";
  if (gender === "female") return "5/2 · 7.2 ч (будни)";
  if (gender === "male") return "5/2 · 8 ч (будни)";
  return "5/2";
}

function genderLabel(g: EmployeeGender): string {
  if (g === "female") return "Женский";
  if (g === "male") return "Мужской";
  return "Не указан";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10));
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString("ru-RU");
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[11rem_1fr] sm:items-baseline sm:gap-x-3">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <div className="text-sm text-slate-900 dark:text-slate-100">{children}</div>
    </div>
  );
}

function DirectoryBody({ row }: { row: EmployeeDirectoryRowOut }) {
  return (
    <div className="space-y-5 text-sm">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Основное
        </h3>
        <div className="space-y-2">
          <Field label="ФИО">{row.full_name}</Field>
          <Field label="Email">{row.email}</Field>
          <Field label="Статус">{row.is_active ? "Активен" : "Неактивен"}</Field>
          <Field label="Дата рождения">{fmtDate(row.birth_date)}</Field>
          <Field label="Должность">{row.position?.name ?? "—"}</Field>
          <Field label="Пол">{genderLabel(row.gender)}</Field>
          <Field label="График работы">{workScheduleLabel(row.work_schedule_kind, row.gender)}</Field>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Производственные системы
        </h3>
        {row.systems.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Не указаны</p>
        ) : (
          <ul className="list-inside list-disc space-y-1 text-slate-900 dark:text-slate-100">
            {row.systems.map((s) => (
              <li key={s.id}>{s.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Отпуск (периоды в графике)
        </h3>
        {row.vacation_periods.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Не заданы</p>
        ) : (
          <ul className="space-y-1 text-slate-900 dark:text-slate-100">
            {row.vacation_periods.map((vp, i) => (
              <li key={`${vp.start}-${vp.end}-${i}`}>
                {fmtDate(vp.start)} — {fmtDate(vp.end)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Экзамен и пропуск
        </h3>
        <div className="space-y-2">
          <Field label="Экзамен по электробезопасности">{row.exam_electrical_passed ? "Сдан" : "Не сдан"}</Field>
          <Field label="Дата сдачи">{fmtDate(row.exam_electrical_date)}</Field>
          <Field label="Экзамен действителен до">{fmtDate(row.exam_electrical_valid_to)}</Field>
          <Field label="Пропуск">{row.pass_has ? "Есть" : "Нет"}</Field>
          {row.pass_number && (
            <Field label="Номер пропуска">{row.pass_number}</Field>
          )}
          <Field label="Пропуск с">{fmtDate(row.pass_valid_from)}</Field>
          <Field label="Пропуск до">{fmtDate(row.pass_valid_to)}</Field>
        </div>
        {row.notes?.trim() && (
          <div className="mt-3 rounded-xl bg-slate-50/90 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
            <p className="font-medium text-slate-600 dark:text-slate-400">Примечание</p>
            <p className="mt-1 whitespace-pre-wrap">{row.notes}</p>
          </div>
        )}
      </section>
    </div>
  );
}

type Props = {
  userId: string | null;
  onClose: () => void;
};

/**
 * Карточка сотрудника из кадрового справочника (только чтение). Доступ к API — право `employee_directory.read`.
 */
export function EmployeeDirectoryViewModal({ userId, onClose }: Props) {
  const open = !!userId;

  const q = useQuery({
    queryKey: ["employee-directory", "user", userId ?? ""],
    queryFn: () => getEmployeeDirectoryUser(userId!),
    enabled: open,
  });

  const { backdropProps, stopPanelPointer } = useModalLayer(open, onClose);

  if (!userId) return null;

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
    >
      <div
        className="flex max-h-[min(92vh,52rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-600/60 dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-view-title"
        onClick={stopPanelPointer}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-slate-600/60">
          <h2 id="employee-view-title" className="text-lg font-semibold text-slate-900 dark:text-white">
            {q.data?.full_name ?? "Сотрудник"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {q.isPending && <p className="text-sm text-slate-500">Загрузка…</p>}
          {q.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {q.error instanceof ApiError ? q.error.detail : "Не удалось загрузить данные"}
            </p>
          )}
          {q.isSuccess && q.data && <DirectoryBody row={q.data} />}
        </div>

        <div className="shrink-0 border-t border-slate-200/80 px-5 py-3 dark:border-slate-600/60">
          <Link
            to="/employee-directory"
            className="text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
            onClick={onClose}
          >
            Открыть кадровый справочник →
          </Link>
        </div>
      </div>
    </div>
  );
}
