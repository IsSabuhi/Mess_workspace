/** Слишком большой MD-parse в TipTap блокирует главный поток. */
export const MARKDOWN_PASTE_MAX_CHARS = 12_000;
/** Выше этого HTML из Word/Obsidian не отдаём TipTap — только text/plain. */
export const HUGE_HTML_PASTE_CHARS = 16_000;
/** Parse markdown только для коротких вставок; длинные — абзацами, без marked. */
export const MARKDOWN_PARSE_MAX_CHARS = 8_000;

/** Эвристика: похоже на Markdown (а не просто обычный текст). */
export function looksLikeMarkdown(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2 || t.length > MARKDOWN_PASTE_MAX_CHARS) return false;
  if (/^#{1,6}\s+\S/m.test(t) || /^```[\w+-]*/m.test(t)) return true;
  if (/!\[[^\]]*\]\([^)\n]+\)/.test(t)) return true;
  let score = 0;
  if (/\*\*[^*\n]+\*\*/.test(t) || /__[^_\n]+__/.test(t)) score += 1;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) score += 1;
  if ((t.match(/^[-*+]\s+\S/gm) ?? []).length >= 2) score += 1;
  if ((t.match(/^\d+\.\s+\S/gm) ?? []).length >= 2) score += 1;
  if (/^>\s+\S/m.test(t)) score += 1;
  if (/^---+$/m.test(t)) score += 1;
  return score >= 2;
}

export function hasMarkdownTable(text: string): boolean {
  return /^\|.+\|/m.test(text) && /^\|\s*[-:| ]+\|/m.test(text);
}

function isSafeImageSrc(src: string): boolean {
  const s = src.trim();
  return (
    /^https?:\/\//i.test(s) ||
    s.startsWith("data:image/") ||
    s.startsWith("/mes/files/") ||
    s.startsWith("/files/") ||
    s.startsWith("/uploads/") ||
    s.startsWith("/mes/uploads/")
  );
}

function imagePlaceholder(label: string): string {
  return `\n\n> 📎 «${label}» — вставьте скрин кнопкой или Ctrl+V.\n\n`;
}

/** Локальные `![](url)` / file:// — не URL нашего хранилища. */
export function sanitizeMarkdownImages(text: string): string {
  return text.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt: string, rawSrc: string) => {
    const src = rawSrc.trim().replace(/^<|>$/g, "").replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    if (isSafeImageSrc(src)) return full;
    let name = src;
    try {
      name = decodeURIComponent(src.split(/[/\\]/).pop() || src);
    } catch {
      /* keep */
    }
    const label = alt?.trim() ? `${alt.trim()} (${name})` : name;
    return imagePlaceholder(label);
  });
}

/**
 * Neutralize wiki/broken images before marked. Keep `![[путь]]` as visible text
 * (inline code) so the user can replace it with a real screenshot later.
 */
export function sanitizeObsidianPaste(text: string): string {
  let s = text.replace(/\r\n/g, "\n");
  s = s.replace(/!\[\[([^\]]*)\]\]/g, "`![[$1]]`");
  s = s.replace(/\[\[([^\]|\n]+)(?:\|[^\]]+)?\]\]/g, "$1");
  s = sanitizeMarkdownImages(s);
  s = s.replace(/!\[(?![^\]]*\]\()/g, "");
  s = s.replace(/==([^=\n]+)==/g, "**$1**");
  return s;
}

export function canParsePastedMarkdown(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MARKDOWN_PARSE_MAX_CHARS) return false;
  if (hasMarkdownTable(t)) return false;
  if (t.includes("![[") || /!\[(?![^\]]*\]\()/.test(t)) return false;
  return looksLikeMarkdown(t) || /```[\w+-]*/.test(t);
}

export function htmlHasUnsafeImages(html: string): boolean {
  if (!/<img\b/i.test(html)) return false;
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const srcMatch = m[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = (srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? "").trim();
    if (!src || !isSafeImageSrc(src)) return true;
  }
  return false;
}

/** HTML из Obsidian/Word, который TipTap не должен парсить (висит вкладка). */
export function clipboardHtmlIsDangerous(html: string, plainLen: number): boolean {
  if (!html) return false;
  if (html.length >= HUGE_HTML_PASTE_CHARS) return true;
  if (/file:|app:\/\/|atom:\/\/|obsidian:\/\//i.test(html)) return true;
  if (/<style\b|mso-|urn:schemas-microsoft/i.test(html)) return true;
  if (htmlHasUnsafeImages(html)) return true;
  if (plainLen > 0 && html.length >= 4_000 && html.length > plainLen * 3) return true;
  return false;
}

function textRuns(s: string): Record<string, unknown>[] {
  if (!s) return [];
  const out: Record<string, unknown>[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: "text", text: s.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith("**")) {
      out.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "bold" }] });
    } else {
      out.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "code" }] });
    }
    last = m.index + token.length;
  }
  if (last < s.length) out.push({ type: "text", text: s.slice(last) });
  return out;
}

function paragraphNode(s: string): Record<string, unknown> {
  const content = textRuns(s);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function imageNode(alt: string, src: string): Record<string, unknown> | null {
  const url = src.trim().replace(/^<|>$/g, "").replace(/^["']|["']$/g, "");
  if (!isSafeImageSrc(url)) return null;
  return { type: "image", attrs: { src: url, alt: alt.trim() } };
}

export function markdownToTipTapDoc(raw: string): { type: "doc"; content: Record<string, unknown>[] } {
  return { type: "doc", content: obsidianTextToTipTapContent(raw) };
}

function listItemNode(s: string): Record<string, unknown> {
  return { type: "listItem", content: [paragraphNode(s)] };
}

/**
 * Вставка из Obsidian без marked/TipTap-markdown (они зависают на `![[картинка]]` и оборванном `![`).
 * `![[Pasted image …]]` остаётся текстом — путь виден, картинку можно вставить отдельно.
 */
export function obsidianTextToTipTapContent(raw: string): Record<string, unknown>[] {
  const lines = raw.replace(/\r\n/g, "\n").slice(0, 80_000).split("\n");
  const nodes: Record<string, unknown>[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```([\w+-]*)\s*$/.exec(line.trim());
    if (fence) {
      const lang = fence[1] || "plaintext";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push({
        type: "codeBlock",
        attrs: { language: lang },
        content: body.length ? [{ type: "text", text: body.join("\n") }] : undefined,
      });
      continue;
    }
    const mdImg = /^!\[([^\]]*)\]\(([^)\n]+)\)$/.exec(line.trim());
    if (mdImg) {
      const img = imageNode(mdImg[1], mdImg[2]);
      nodes.push(img ?? paragraphNode(line));
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const title = heading[2];
      nodes.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: title ? textRuns(title) : undefined,
      });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quotes: Record<string, unknown>[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quotes.push(paragraphNode(lines[i].replace(/^>\s?/, "")));
        i += 1;
      }
      nodes.push({ type: "blockquote", content: quotes });
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: Record<string, unknown>[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(listItemNode(lines[i].replace(/^[-*+]\s+/, "")));
        i += 1;
      }
      nodes.push({ type: "bulletList", content: items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: Record<string, unknown>[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(listItemNode(lines[i].replace(/^\d+\.\s+/, "")));
        i += 1;
      }
      nodes.push({ type: "orderedList", content: items });
      continue;
    }
    nodes.push(paragraphNode(line));
    i += 1;
  }
  return nodes.length ? nodes : [{ type: "paragraph" }];
}

export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .slice(0, 200_000)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineToHtml(n: Record<string, unknown>): string {
  if (n.type === "hardBreak") return "<br>";
  let t = escHtml(String(n.text ?? ""));
  const marks = n.marks as { type: string }[] | undefined;
  if (!marks?.length) return t;
  for (const m of marks) {
    if (m.type === "bold") t = `<strong>${t}</strong>`;
    else if (m.type === "code") t = `<code>${t}</code>`;
    else if (m.type === "italic") t = `<em>${t}</em>`;
  }
  return t;
}

function nodeToHtml(n: Record<string, unknown>): string {
  const type = String(n.type ?? "");
  const children = (n.content as Record<string, unknown>[] | undefined) ?? [];
  const inner = children.map((c) => (c.type === "text" || c.type === "hardBreak" ? inlineToHtml(c) : nodeToHtml(c))).join("");
  if (type === "paragraph") return `<p>${inner || "<br>"}</p>`;
  if (type === "heading") {
    const level = Math.min(3, Math.max(1, Number((n.attrs as { level?: number } | undefined)?.level) || 2));
    return `<h${level}>${inner}</h${level}>`;
  }
  if (type === "blockquote") return `<blockquote>${inner}</blockquote>`;
  if (type === "bulletList") return `<ul>${inner}</ul>`;
  if (type === "orderedList") return `<ol>${inner}</ol>`;
  if (type === "listItem") return `<li>${inner}</li>`;
  if (type === "codeBlock") {
    const lang = String((n.attrs as { language?: string } | undefined)?.language ?? "");
    const body = children.map((c) => String(c.text ?? "")).join("");
    const cls = lang ? ` class="language-${escHtml(lang)}"` : "";
    return `<pre><code${cls}>${escHtml(body)}</code></pre>`;
  }
  if (type === "image") {
    const attrs = (n.attrs as { src?: string; alt?: string } | undefined) ?? {};
    return `<p><img src="${escHtml(attrs.src ?? "")}" alt="${escHtml(attrs.alt ?? "")}"></p>`;
  }
  return inner ? `<p>${inner}</p>` : "";
}

/** Старые заметки УСПД были Markdown; редактор БЗ ждёт HTML. marked не используем. */
export function notesToEditorHtml(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "<p></p>";
  if (/<[a-z][\s\S]*>/i.test(t) && /<\/[a-z][\s\S]*>/i.test(t)) return raw ?? "<p></p>";
  const html = obsidianTextToTipTapContent(t).map(nodeToHtml).join("");
  return html || "<p></p>";
}

export function htmlNotesEmpty(html: string | null | undefined): boolean {
  if (!html?.trim()) return true;
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim() === "";
}
