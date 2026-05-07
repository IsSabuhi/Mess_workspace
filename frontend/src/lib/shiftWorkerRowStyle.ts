/** Цвет всей строки для бригад с совпадающим шаблоном месяца. */
const SHIFT_ROW_CLASSES_BY_PHASE = [
  "bg-blue-500/24 text-slate-900 dark:bg-blue-500/26 dark:text-slate-100",
  "bg-yellow-300/45 text-yellow-950 dark:bg-yellow-400/14 dark:text-yellow-50",
  "bg-emerald-500/24 text-slate-900 dark:bg-emerald-500/26 dark:text-slate-100",
  "bg-violet-500/24 text-slate-900 dark:bg-violet-500/26 dark:text-slate-100",
] as const;

/** Только фон (для `<td>` при `border-collapse`: фон на `<tr>` часто не виден). */
const SHIFT_ROW_BG_BY_PHASE = [
  "bg-blue-500/24 dark:bg-blue-500/32",
  "bg-yellow-300/45 dark:bg-yellow-400/20",
  "bg-emerald-500/24 dark:bg-emerald-500/32",
  "bg-violet-500/24 dark:bg-violet-500/32",
] as const;

export function shiftRowClassByPhase(phase: number): string {
  const i = Math.max(0, Math.min(3, Math.floor(phase)));
  return SHIFT_ROW_CLASSES_BY_PHASE[i] ?? SHIFT_ROW_CLASSES_BY_PHASE[0];
}

export function shiftRowBgByPhase(phase: number): string {
  const i = Math.max(0, Math.min(3, Math.floor(phase)));
  return SHIFT_ROW_BG_BY_PHASE[i] ?? SHIFT_ROW_BG_BY_PHASE[0];
}

/** Те же четыре оттенка, что раньше по userId — для 2/2 и справочника. */
const SHIFT_ROW_CLASSES_BY_HASH = [
  "bg-[#00B0F0]/14 dark:bg-[#00B0F0]/17 dark:text-slate-100",
  "bg-[#FFEA00]/35 dark:bg-[#E6D300]/14 dark:text-slate-100",
  "bg-[#00B050]/13 dark:bg-[#00B050]/16 dark:text-slate-100",
  "bg-[#FF66CC]/16 dark:bg-[#FF66CC]/14 dark:text-slate-100",
] as const;

function hashMod(input: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

/** Классы фона строки для сменщика не 11-3-8 по id (2/2 и т.д.). */
export function shiftWorkerRowClass(userId: string): string {
  return SHIFT_ROW_CLASSES_BY_HASH[hashMod(userId, SHIFT_ROW_CLASSES_BY_HASH.length)] ?? SHIFT_ROW_CLASSES_BY_HASH[0];
}
