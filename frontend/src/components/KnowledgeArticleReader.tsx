import { useMemo } from "react";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("plaintext", () => ({
  name: "Plaintext",
  aliases: ["text", "txt"],
  disableAutodetect: true,
  contains: [],
}));

/** Подмножество для highlightAuto (быстрее и предсказуемее). */
const HLJS_AUTO_SUBSET = [
  "bash",
  "javascript",
  "typescript",
  "python",
  "json",
  "xml",
  "css",
  "sql",
  "plaintext",
];

const HLJS_LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "xml",
  yaml: "xml",
  html: "xml",
  htm: "xml",
  vue: "xml",
};

function slugifyHeading(s: string): string {
  const t = s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return t || "section";
}

function assignHeadingIds(root: HTMLElement): void {
  const slugCounts = new Map<string, number>();
  root.querySelectorAll("h1, h2, h3").forEach((node) => {
    const text = (node.textContent || "").trim();
    if (!text) return;
    const base = slugifyHeading(text);
    const n = (slugCounts.get(base) || 0) + 1;
    slugCounts.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    node.id = id;
  });
}

function languageFromClassList(el: Element): string | null {
  if (!(el instanceof HTMLElement)) return null;
  const found = el.className.split(/\s+/).find((c) => c.startsWith("language-"));
  if (!found) return null;
  const raw = found.replace(/^language-/, "").trim();
  if (!raw) return null;
  return HLJS_LANG_ALIASES[raw] ?? raw;
}

function extractLanguage(pre: Element, code: Element): string {
  return languageFromClassList(code) ?? languageFromClassList(pre) ?? "plaintext";
}

function highlightCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll("pre code").forEach((block) => {
    const el = block as HTMLElement;
    const pre = el.parentElement;
    if (!pre || pre.tagName !== "PRE") return;

    const text = el.textContent ?? "";
    const lang = extractLanguage(pre, el);

    const applyResult = (value: string, outLang: string) => {
      el.innerHTML = value;
      el.className = `hljs language-${outLang}`;
    };

    if (hljs.getLanguage(lang)) {
      try {
        const { value } = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        applyResult(value, lang);
        return;
      } catch {
        /* fallback */
      }
    }

    try {
      const auto = hljs.highlightAuto(text, HLJS_AUTO_SUBSET);
      const outLang = auto.language ?? "plaintext";
      applyResult(auto.value, outLang);
    } catch {
      el.textContent = text;
      el.className = "hljs language-plaintext";
    }
  });
}

/**
 * Подсветка и id заголовков считаются из строки HTML до вставки в DOM — тогда React не затирает разметку при ре-рендере.
 * DOMParser — без document.createElement в рендере.
 */
function buildArticleDisplayHtml(raw: string): string {
  if (!raw) return "";
  const doc = new DOMParser().parseFromString(
    '<!DOCTYPE html><html><body><div id="kb-article-build-root"></div></body></html>',
    "text/html",
  );
  const wrap = doc.getElementById("kb-article-build-root");
  if (!wrap) return raw;
  wrap.innerHTML = raw;
  assignHeadingIds(wrap);
  highlightCodeBlocks(wrap);
  return wrap.innerHTML;
}

export type ArticleTocItem = { id: string; text: string; level: number };

/** Оглавление по сохранённому HTML (совпадает с id заголовков в `KnowledgeArticleReader`). */
export function extractTocFromArticleHtml(html: string): ArticleTocItem[] {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const slugCounts = new Map<string, number>();
  const out: ArticleTocItem[] = [];
  doc.querySelectorAll("h1, h2, h3").forEach((el) => {
    const text = (el.textContent || "").trim();
    if (!text) return;
    const base = slugifyHeading(text);
    const n = (slugCounts.get(base) || 0) + 1;
    slugCounts.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    out.push({ id, text, level: Number(el.tagName.slice(1)) });
  });
  return out;
}

type Props = {
  html: string;
  className?: string;
};

/**
 * Статичный просмотр: HTML из БД. Подсветка — `hljs.highlight()`, тема vs2015 (main.tsx).
 */
export function KnowledgeArticleReader({ html, className = "" }: Props) {
  const displayHtml = useMemo(() => buildArticleDisplayHtml(html), [html]);

  return (
    <div
      className={`kb-article-body w-full min-w-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: displayHtml }}
    />
  );
}
