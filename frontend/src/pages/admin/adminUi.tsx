import type { PermissionOut } from "../../api/roles";

export function groupPermissions(perms: PermissionOut[]): Map<string, PermissionOut[]> {
  const m = new Map<string, PermissionOut[]>();
  for (const p of perms) {
    const key = p.code.split(".")[0] || "other";
    const arr = m.get(key) ?? [];
    arr.push(p);
    m.set(key, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.code.localeCompare(b.code));
  }
  return new Map([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const PERM_GROUP_LABELS: Record<string, string> = {
  tasks: "Задачи",
  board: "Настройки доски",
  boards: "Доски",
  systems: "Производственные системы",
  positions: "Должности",
  users: "Пользователи",
  roles: "Роли",
  admin: "Админка",
  knowledge: "База знаний",
  employee_directory: "Справочник сотрудников",
  schedule: "График",
  other: "Прочее",
};

export function permissionGroupTitle(prefix: string): string {
  return PERM_GROUP_LABELS[prefix] ?? prefix;
}

export function PermToggle({
  checked,
  disabled,
  busy,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled: boolean;
  busy: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label
      className={`relative inline-flex shrink-0 items-center ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled || busy}
        onChange={onChange}
        aria-label={ariaLabel}
        aria-checked={checked}
      />
      <span className="relative h-7 w-12 rounded-full bg-slate-200 transition peer-checked:bg-violet-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-400/60 dark:bg-slate-600">
        <span
          className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform dark:bg-slate-100 ${
            checked ? "translate-x-5" : "translate-x-0"
          } ${busy ? "opacity-70" : ""}`}
        />
      </span>
    </label>
  );
}

export function AdminLock({
  allowed,
  hint,
  children,
}: {
  allowed: boolean;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {children}
      {!allowed && (
        <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
          {hint} Нажмите на заблокированную кнопку — появится сообщение.
        </p>
      )}
    </div>
  );
}
