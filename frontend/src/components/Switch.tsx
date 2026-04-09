import { cn } from "../lib/cn";

type Props = {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  className?: string;
};

/**
 * Доступный переключатель (role="switch") в стиле iOS / Material.
 */
export function Switch({ checked, onCheckedChange, disabled, id, "aria-labelledby": labelledBy, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      id={id}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent px-1 transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
        "disabled:cursor-not-allowed disabled:opacity-45",
        checked
          ? "bg-sky-500 shadow-inner shadow-sky-900/10 dark:bg-sky-600"
          : "bg-slate-200 dark:bg-slate-600",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transition duration-200 ease-out",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
