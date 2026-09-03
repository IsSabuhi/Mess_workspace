import type { EmployeeDirectoryRowOut } from "../api/employeeDirectory";
import { asInputDate } from "../lib/employeeDirectoryFormat";

export function DirectoryNameCell({ row }: { row: EmployeeDirectoryRowOut }) {
  return (
    <>
      <p className="font-medium text-slate-900 dark:text-white">{row.full_name}</p>
      <p className="text-xs text-slate-500">{row.email}</p>
      {row.is_dismissed ? (
        <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">
          Уволен{row.dismissed_at ? ` ${asInputDate(row.dismissed_at)}` : ""}
        </p>
      ) : null}
    </>
  );
}
