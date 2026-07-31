/** Транслитерация кириллицы (упрощённый ГОСТ) + slug для URL. */

const CYR_TO_LAT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function transliterate(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    if (lower in CYR_TO_LAT) {
      const mapped = CYR_TO_LAT[lower];
      out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Заголовок → URL-slug: латиница, цифры, дефисы.
 * «Инструкция по настройке» → «instrukciya-po-nastrojke»
 */
export function slugifyTitle(input: string, fallback = "item"): string {
  const raw = transliterate(input)
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return raw || fallback;
}

/** Если base занят — добавляет -2, -3, … */
export function uniqueSlug(base: string, taken: Iterable<string>, fallback = "item"): string {
  const existing = new Set(
    [...taken].map((s) => s.toLowerCase()).filter(Boolean),
  );
  let candidate = (base || fallback).toLowerCase();
  if (!existing.has(candidate)) return candidate;
  let n = 2;
  while (existing.has(`${candidate}-${n}`)) n += 1;
  return `${candidate}-${n}`;
}
