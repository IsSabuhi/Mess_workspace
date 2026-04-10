/**
 * Подсветка строк сменщиков — те же оттенки, что в «График_смен.xlsx» (ARGB → #RGB):
 * голубой #00B0F0, жёлтый #FFFF00, зелёный #00B050, розовый #FF66CC.
 * Цвет стабильно привязан к id сотрудника (распределение по 4 «бригадам»).
 */
const SHIFT_ROW_CLASSES = [
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

/** Классы фона строки для сменщика (один из четырёх цветов по id). */
export function shiftWorkerRowClass(userId: string): string {
  return SHIFT_ROW_CLASSES[hashMod(userId, SHIFT_ROW_CLASSES.length)] ?? SHIFT_ROW_CLASSES[0];
}
