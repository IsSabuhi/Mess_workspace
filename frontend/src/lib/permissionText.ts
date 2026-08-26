export type ParsedPermissionText = {
  title: string;
  subtitle: string;
  note: string | null;
};

/** Разбор description из API: заголовок, текст, необязательное пояснение после `---`. */
export function parsePermissionText(code: string, description: string | null | undefined): ParsedPermissionText {
  const raw = (description ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) {
    return { title: code.replace(/\./g, " · "), subtitle: code, note: null };
  }
  const [main, ...noteParts] = raw.split(/\n---\n/);
  const note = noteParts.join("\n---\n").trim() || null;
  const lines = main.split("\n").map((x) => x.trim()).filter(Boolean);
  const title = lines[0] || code.replace(/\./g, " · ");
  const subtitle = lines.slice(1).join(" ") || code;
  return { title, subtitle, note };
}
