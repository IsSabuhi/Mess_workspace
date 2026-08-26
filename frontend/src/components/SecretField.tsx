import { Copy, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

import { toastError, toastSuccess } from "../lib/toast";

const inputClassMd =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-20 text-sm outline-none ring-sky-400/30 transition focus:border-sky-400 focus:ring-4 dark:border-slate-600 dark:bg-slate-800 dark:text-white";
const inputClassSm =
  "w-full min-w-[7.5rem] rounded-lg border border-slate-200 bg-white px-2 py-1 pr-14 font-mono text-xs outline-none ring-sky-400/30 transition focus:border-sky-400 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

type Props = {
  label?: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  autoComplete?: string;
  size?: "md" | "sm";
};

export function SecretField({
  label,
  value,
  onChange,
  readOnly = false,
  placeholder,
  autoComplete = "new-password",
  size = "md",
}: Props) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const hasValue = value.trim().length > 0;

  async function copyValue() {
    if (!hasValue) return;
    try {
      await navigator.clipboard.writeText(value);
      toastSuccess("Скопировано");
    } catch {
      toastError("Не удалось скопировать");
    }
  }

  const field = (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        readOnly={readOnly}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className={`${size === "sm" ? inputClassSm : inputClassMd} ${readOnly ? "cursor-default bg-slate-50 dark:bg-slate-900/70" : ""}`}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        {hasValue && (
          <button
            type="button"
            onClick={() => void copyValue()}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            title="Скопировать"
            aria-label="Скопировать"
          >
            <Copy className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          title={visible ? "Скрыть" : "Показать"}
          aria-label={visible ? "Скрыть" : "Показать"}
        >
          {visible ? (
            <EyeOff className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          ) : (
            <Eye className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          )}
        </button>
      </div>
    </div>
  );

  if (readOnly && !hasValue) {
    if (!label) return <span className="text-xs text-slate-400">—</span>;
    return (
      <div className="text-sm">
        <span className="mb-1 block text-slate-500 dark:text-slate-400">{label}</span>
        <p className="text-slate-800 dark:text-slate-100">—</p>
      </div>
    );
  }

  if (!label) return field;

  return (
    <label className="block text-sm" htmlFor={id}>
      <span className="mb-1 block text-slate-500 dark:text-slate-400">{label}</span>
      {field}
    </label>
  );
}
