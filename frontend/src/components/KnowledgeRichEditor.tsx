import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";

import { useModalLayer } from "../lib/useModalLayer";
import { toast } from "sonner";
import type { Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Highlight } from "@tiptap/extension-highlight";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";

const lowlight = createLowlight();
lowlight.register("bash", bash);
lowlight.register("javascript", javascript);
lowlight.register("typescript", typescript);
lowlight.register("python", python);
lowlight.register("json", json);
lowlight.register("xml", xml);
lowlight.register("css", css);
lowlight.register("sql", sql);
lowlight.register("plaintext", () => ({
  name: "Plaintext",
  aliases: ["text", "txt"],
  disableAutodetect: true,
  contains: [],
}));

type Props = {
  articleKey: string;
  initialHtml: string;
  editable: boolean;
  onHtmlChange: (html: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  onHeadingsChange?: (rows: { id: string; text: string; level: number }[]) => void;
};

const FONTS = [
  { label: "По умолчанию", value: "" },
  { label: "DM Sans", value: "DM Sans, system-ui, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, monospace" },
];

const CODE_LANGUAGES = [
  { label: "Код (авто)", value: "" },
  { label: "Bash", value: "bash" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "JSON", value: "json" },
  { label: "XML/HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "SQL", value: "sql" },
];

function collectClipboardImageFiles(event: ClipboardEvent): File[] {
  const out: File[] = [];
  const dt = event.clipboardData;
  if (!dt) return out;
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files.item(i);
      if (f?.type.startsWith("image/")) out.push(f);
    }
  }
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

function collectDataTransferImageFiles(dataTransfer: DataTransfer | null): File[] {
  const out: File[] = [];
  if (!dataTransfer?.files?.length) return out;
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const f = dataTransfer.files.item(i);
    if (f?.type.startsWith("image/")) out.push(f);
  }
  return out;
}

/** Слишком большой MD-parse в TipTap блокирует главный поток — выше порога идём обычной вставкой. */
const MARKDOWN_PASTE_MAX_CHARS = 12_000;
/** Гигантский HTML из Word/Docs тоже вешает редактор — режем до plain text. */
const HUGE_HTML_PASTE_CHARS = 120_000;

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

/** `![](Pasted image …)` / file:// — не URL нашего хранилища; TipTap+браузер на них зависают. */
function sanitizeMarkdownImages(text: string): string {
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
    return `\n\n> 📎 Изображение: «${label}» — вставьте скрин кнопкой «Изображение» (из файла в буфере не подхватывается как URL).\n\n`;
  });
}

function stripUnsafeImagesFromHtml(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = (srcMatch?.[1] ?? srcMatch?.[2] ?? srcMatch?.[3] ?? "").trim();
    if (src && isSafeImageSrc(src)) return tag;
    const altMatch = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const alt = (altMatch?.[1] ?? altMatch?.[2] ?? "").trim() || "изображение";
    return `<p><em>📎 ${alt} — вставьте скрин через «Изображение»</em></p>`;
  });
}

function htmlHasUnsafeImages(html: string): boolean {
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

/** Эвристика: похоже на Markdown (а не просто обычный текст). */
function looksLikeMarkdown(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2 || t.length > MARKDOWN_PASTE_MAX_CHARS) return false;
  // Сильные маркеры — достаточно одного
  if (/^#{1,6}\s+\S/m.test(t) || /^```[\w+-]*/m.test(t) || /^\|.+\|/m.test(t)) return true;
  if (/!\[[^\]]*\]\([^)\n]+\)/.test(t)) return true;
  // Слабые (списки, жирный) — нужны хотя бы два, иначе обычный текст с «-» вешает MD-парсер
  let score = 0;
  if (/\*\*[^*\n]+\*\*/.test(t) || /__[^_\n]+__/.test(t)) score += 1;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) score += 1;
  if ((t.match(/^[-*+]\s+\S/gm) ?? []).length >= 2) score += 1;
  if ((t.match(/^\d+\.\s+\S/gm) ?? []).length >= 2) score += 1;
  if (/^>\s+\S/m.test(t)) score += 1;
  if (/^---+$/m.test(t)) score += 1;
  return score >= 2;
}

/** Есть ли rich HTML в буфере (Word/браузер) — тогда не трогаем, пусть TipTap сам вставит. */
function clipboardHasRichHtml(html: string | undefined): boolean {
  if (!html?.trim()) return false;
  return /<(h[1-6]|ul|ol|li|table|tr|td|th|strong|em|b|i|a|pre|code|blockquote|img)\b/i.test(html);
}

export function KnowledgeRichEditor({
  articleKey,
  initialHtml,
  editable,
  onHtmlChange,
  onUploadImage,
  onHeadingsChange,
}: Props) {
  const editorRef = useRef<Editor | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef(onUploadImage);
  const editableRef = useRef(editable);
  const onHtmlChangeRef = useRef(onHtmlChange);
  const onHeadingsChangeRef = useRef(onHeadingsChange);
  const headingsTimerRef = useRef<number | null>(null);
  const htmlTimerRef = useRef<number | null>(null);
  uploadRef.current = onUploadImage;
  editableRef.current = editable;
  onHtmlChangeRef.current = onHtmlChange;
  onHeadingsChangeRef.current = onHeadingsChange;

  const flushHtmlChange = useCallback((ed: Editor) => {
    if (ed.isDestroyed) return;
    if (htmlTimerRef.current !== null) {
      window.clearTimeout(htmlTimerRef.current);
      htmlTimerRef.current = null;
    }
    onHtmlChangeRef.current(ed.getHTML());
  }, []);

  const scheduleHtmlChange = useCallback((ed: Editor) => {
    if (ed.isDestroyed) return;
    if (htmlTimerRef.current !== null) window.clearTimeout(htmlTimerRef.current);
    htmlTimerRef.current = window.setTimeout(() => {
      htmlTimerRef.current = null;
      if (!ed.isDestroyed) onHtmlChangeRef.current(ed.getHTML());
    }, 250);
  }, []);

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState("");
  const closeLinkModal = useCallback(() => setLinkModalOpen(false), []);
  const { backdropProps: linkModalBackdrop, stopPanelPointer: linkModalPanelStop } = useModalLayer(
    linkModalOpen,
    closeLinkModal,
  );

  const insertImagesFromFiles = useCallback(async (files: File[], insertPos?: number | null) => {
    if (!files.length) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const url = await uploadRef.current(file);
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        const chain = ed.chain().focus();
        if (i === 0 && insertPos != null) {
          chain.insertContentAt(insertPos, { type: "image", attrs: { src: url } });
        } else {
          chain.setImage({ src: url });
        }
        chain.run();
      } catch (e) {
        console.error("[KnowledgeRichEditor] image upload failed", e);
      }
    }
  }, []);

  const editor = useEditor(
    {
      immediatelyRender: false,
      // Иначе каждый transaction (в т.ч. большая вставка) синхронно перерисовывает React-дерево.
      shouldRerenderOnTransaction: false,
      editable,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true },
          codeBlock: false,
        }),
        CodeBlockLowlight.configure({ lowlight }),
        TableKit.configure({
          table: { resizable: false },
        }),
        Image.configure({
          HTMLAttributes: { class: "max-w-full rounded-lg" },
        }),
        TextStyle,
        Color,
        FontFamily.configure({ types: ["textStyle"] }),
        Highlight.configure({ multicolor: true }),
        Markdown.configure({
          markedOptions: { gfm: true, breaks: false },
        }),
        Placeholder.configure({
          placeholder: "Начните писать статью… Markdown: # заголовок, **жирный**, - список",
          emptyEditorClass: "is-editor-empty",
        }),
      ],
      content: initialHtml || "<p></p>",
      onUpdate: ({ editor: ed }) => {
        if (ed.isDestroyed) return;
        scheduleHtmlChange(ed);
        if (onHeadingsChangeRef.current) {
          if (headingsTimerRef.current !== null) window.clearTimeout(headingsTimerRef.current);
          headingsTimerRef.current = window.setTimeout(() => {
            headingsTimerRef.current = null;
            if (ed.isDestroyed || !onHeadingsChangeRef.current) return;
            const headings: { id: string; text: string; level: number }[] = [];
            ed.state.doc.descendants((node) => {
              const level = node.type.name === "heading" ? Number(node.attrs.level) : 0;
              if (level < 1 || level > 3) return;
              const text = node.textContent.trim();
              if (text) headings.push({ id: `toc-${headings.length}`, text, level });
            });
            onHeadingsChangeRef.current(headings);
          }, 300);
        }
      },
      editorProps: {
        attributes: {
          class: "kb-editor-content",
        },
        handlePaste: (_view, event) => {
          if (!editableRef.current) return false;
          const ed = editorRef.current;
          if (!ed || ed.isDestroyed) return false;

          const text = event.clipboardData?.getData("text/plain") ?? "";
          const html = event.clipboardData?.getData("text/html") ?? "";
          const files = collectClipboardImageFiles(event);
          const trimmed = text.trim();
          const substantialText =
            trimmed.length >= 40 || looksLikeMarkdown(trimmed) || /```[\w+-]*/.test(trimmed);

          // в буфере и текст заметки, и файлы скринов.
          // Раньше при files.length>0 текст отбрасывался, а local ![](...)/img вешали TipTap.
          if (substantialText) {
            event.preventDefault();
            const md = sanitizeMarkdownImages(text);
            try {
              if (looksLikeMarkdown(md) || /```/.test(md)) {
                ed.chain().focus().insertContent(md, { contentType: "markdown" }).run();
              } else if (html && html.length < HUGE_HTML_PASTE_CHARS) {
                ed.chain().focus().insertContent(stripUnsafeImagesFromHtml(html)).run();
              } else {
                ed.chain().focus().insertContent(md).run();
              }
            } catch (err) {
              console.error("[KnowledgeRichEditor] paste failed, plain text fallback", err);
              ed.chain().focus().insertContent(trimmed).run();
            }
            if (files.length) {
              // Скрины из буфера — загрузить в MinIO и вставить после текста.
              void insertImagesFromFiles(files);
            } else if (/!\[[^\]]*\]\((?!https?:)/i.test(text) || htmlHasUnsafeImages(html)) {
              toast.info("Скриншоты", {
                description:
                  "Текст вставлен. Локальные картинки сюда не подтягиваются — вставьте их кнопкой «Изображение».",
                duration: 7000,
              });
            }
            return true;
          }

          if (files.length) {
            event.preventDefault();
            void insertImagesFromFiles(files);
            return true;
          }

          // Word/Docs иногда кладут огромный HTML со стилями — парсинг вешает вкладку.
          if (html.length >= HUGE_HTML_PASTE_CHARS && text) {
            event.preventDefault();
            ed.chain().focus().insertContent(sanitizeMarkdownImages(text)).run();
            return true;
          }

          // HTML со «битыми» img (/file://) без длинного plain text
          if (html && htmlHasUnsafeImages(html)) {
            event.preventDefault();
            if (trimmed && looksLikeMarkdown(trimmed)) {
              ed.chain().focus().insertContent(sanitizeMarkdownImages(text), { contentType: "markdown" }).run();
            } else {
              ed.chain().focus().insertContent(stripUnsafeImagesFromHtml(html)).run();
            }
            toast.info("Скриншоты пропущены", {
              description: "Вставьте изображения кнопкой «Изображение».",
              duration: 5500,
            });
            return true;
          }

          // Вставка Markdown из .md / чата / GitHub — только если нет rich HTML и текст умеренный
          if (text && looksLikeMarkdown(text) && !clipboardHasRichHtml(html)) {
            event.preventDefault();
            ed.chain().focus().insertContent(sanitizeMarkdownImages(text), { contentType: "markdown" }).run();
            return true;
          }
          return false;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (!editableRef.current || moved) return false;
          const files = collectDataTransferImageFiles(event.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          void insertImagesFromFiles(files, pos ?? undefined);
          return true;
        },
      },
    },
    // Не завязывать на articleKey: иначе useEditor destroy'ит инстанс, а эффект ещё зовёт
    // editor.commands → TypeError: Cannot read properties of null (reading 'commands').
    [insertImagesFromFiles, scheduleHtmlChange],
  );

  useEffect(() => {
    editorRef.current = editor && !editor.isDestroyed ? editor : null;
  }, [editor]);

  useEffect(
    () => () => {
      if (headingsTimerRef.current !== null) window.clearTimeout(headingsTimerRef.current);
      const ed = editorRef.current;
      if (ed && !ed.isDestroyed) flushHtmlChange(ed);
      else if (htmlTimerRef.current !== null) window.clearTimeout(htmlTimerRef.current);
    },
    [flushHtmlChange],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  /** Только при смене статьи — не при каждом обновлении html из родителя (иначе сбрасывается курсор). */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(initialHtml || "<p></p>", { emitUpdate: false });
  }, [editor, articleKey]);

  const pickImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await insertImagesFromFiles([file]);
    };
    input.click();
  }, [insertImagesFromFiles]);

  const openLinkModal = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    if (ed.state.selection.empty) {
      toast.info("Выделите текст для ссылки", {
        description: "Затем снова нажмите «Ссылка» и укажите адрес (URL).",
        duration: 5500,
      });
      return;
    }
    const prevHref = ed.getAttributes("link").href as string | undefined;
    setLinkUrlDraft(prevHref?.trim() ? prevHref : "https://");
    setLinkModalOpen(true);
  }, []);

  const confirmLink = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const t = linkUrlDraft.trim();
    const chain = ed.chain().focus();
    if (!t) {
      chain.extendMarkRange("link").unsetLink().run();
      toast.success("Ссылка снята");
    } else {
      chain.extendMarkRange("link").setLink({ href: t }).run();
      toast.success("Ссылка сохранена");
    }
    setLinkModalOpen(false);
  }, [linkUrlDraft]);

  useEffect(() => {
    if (!linkModalOpen) return;
    const t = window.setTimeout(() => linkInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [linkModalOpen]);

  if (!editor || editor.isDestroyed) {
    return <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700">Загрузка редактора…</div>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
      {editable && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/95 px-2 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-800/90">
          <select
            key={articleKey}
            title="Шрифт текста (применяется к выделению или к вводу)"
            aria-label="Шрифт"
            className="max-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(v).run();
            }}
          >
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            type="color"
            title="Цвет текста (выделите фрагмент или печатайте дальше)"
            aria-label="Цвет текста"
            className="h-8 w-7 cursor-pointer rounded border border-slate-200 bg-white p-0 dark:border-slate-600"
            onInput={(e) => {
              const c = (e.target as HTMLInputElement).value;
              editor.chain().focus().setColor(c).run();
            }}
          />
          <button
            type="button"
            title="Жирный шрифт"
            className="rounded-lg px-2 py-1 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </button>
          <button
            type="button"
            title="Курсив"
            className="rounded-lg px-2 py-1 text-xs italic hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </button>
          <button
            type="button"
            title="Подчёркивание"
            className="rounded-lg px-2 py-1 text-xs underline hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            U
          </button>
          <button
            type="button"
            title="Зачёркивание"
            className="rounded-lg px-2 py-1 text-xs line-through hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            S
          </button>
          <button
            type="button"
            title="Цветной фон под текстом: выделите фрагмент и нажмите (повторно — снять выделение)"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() =>
              editor.chain().focus().toggleHighlight({ color: "rgb(254 240 138)" }).run()
            }
          >
            Фон
          </button>
          <span className="mx-0.5 select-none text-slate-300 dark:text-slate-600">|</span>
          <button
            type="button"
            title="Заголовок первого уровня (крупный). Повторное нажатие — обычный абзац"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => {
              const chain = editor.chain().focus();
              if (editor.isActive("heading", { level: 1 })) chain.setParagraph().run();
              else chain.setHeading({ level: 1 }).run();
            }}
          >
            H1
          </button>
          <button
            type="button"
            title="Заголовок второго уровня. Повторное нажатие — обычный абзац"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => {
              const chain = editor.chain().focus();
              if (editor.isActive("heading", { level: 2 })) chain.setParagraph().run();
              else chain.setHeading({ level: 2 }).run();
            }}
          >
            H2
          </button>
          <button
            type="button"
            title="Заголовок третьего уровня. Повторное нажатие — обычный абзац"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => {
              const chain = editor.chain().focus();
              if (editor.isActive("heading", { level: 3 })) chain.setParagraph().run();
              else chain.setHeading({ level: 3 }).run();
            }}
          >
            H3
          </button>
          <button
            type="button"
            title="Инлайн-код (`код`)"
            className="rounded-lg px-2 py-1 font-mono text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            {"` `"}
          </button>
          <button
            type="button"
            title="Маркированный список"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            •
          </button>
          <button
            type="button"
            title="Нумерованный список"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.
          </button>
          <button
            type="button"
            title="Цитата"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            „
          </button>
          <button
            type="button"
            title="Блок кода (выберите язык справа)"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            &lt;/&gt;
          </button>
          <select
            title="Язык блока кода"
            aria-label="Язык кода"
            className="max-w-[130px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
            value={editor.getAttributes("codeBlock").language ?? ""}
            onChange={(e) => {
              const lang = e.target.value;
              if (!editor.isActive("codeBlock")) {
                editor.chain().focus().setCodeBlock({ language: lang || "plaintext" }).run();
                return;
              }
              editor.chain().focus().updateAttributes("codeBlock", { language: lang || "plaintext" }).run();
            }}
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.label} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="Горизонтальная линия (---)"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            ―
          </button>
          <button
            type="button"
            title="Вставить таблицу 3×3"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            Табл.
          </button>
          <button
            type="button"
            title="Ссылка: сначала выделите текст, затем нажмите и введите URL. Пустой URL — убрать ссылку"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => openLinkModal()}
          >
            Ссылка
          </button>
          <button
            type="button"
            title="Вставить изображение с компьютера"
            className="rounded-lg px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
            onClick={() => pickImage()}
          >
            Изображение
          </button>
        </div>
      )}
      {editable && (
        <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Markdown:{" "}
          <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">#</kbd> заголовок,{" "}
          <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">**</kbd>жирный,{" "}
          <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">-</kbd> список,{" "}
          <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">```</kbd> код · вставка MD из буфера · скриншот{" "}
          <kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">Ctrl+V</kbd>
        </p>
      )}
      {!editable && (
        <p className="border-b border-slate-100 bg-slate-50/80 px-3 py-1.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          Просмотр: редактирование в этом пространстве для вас недоступно.
        </p>
      )}
      <EditorContent
        editor={editor}
        className="min-h-[min(72vh,640px)] cursor-text bg-white px-4 py-4 sm:px-5 sm:py-5 dark:bg-slate-900/50"
        onClick={() => {
          if (!editor.isDestroyed) editor.chain().focus().run();
        }}
      />

      {linkModalOpen && (
        <div
          {...linkModalBackdrop}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div
            className="modal-panel w-full max-w-md rounded-2xl p-5 shadow-soft-lg dark:border-slate-600"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-link-dialog-title"
            onClick={linkModalPanelStop}
          >
            <h2 id="kb-link-dialog-title" className="mb-1 text-base font-semibold text-slate-900 dark:text-white">
              Адрес ссылки
            </h2>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              Действует на выделенный фрагмент. Очистите поле и нажмите «Сохранить», чтобы убрать ссылку.
            </p>
            <input
              ref={linkInputRef}
              type="url"
              value={linkUrlDraft}
              onChange={(e) => setLinkUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmLink();
                }
              }}
              placeholder="https://…"
              className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-xl bg-slate-200 px-4 py-2 text-sm dark:bg-slate-700"
                onClick={closeLinkModal}
              >
                Отмена
              </button>
              <button
                type="button"
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
                onClick={() => confirmLink()}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
