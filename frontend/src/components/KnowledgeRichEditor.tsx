import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Highlight } from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";

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
  uploadRef.current = onUploadImage;
  editableRef.current = editable;

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState("");

  const insertImagesFromFiles = useCallback(async (files: File[], insertPos?: number | null) => {
    const ed = editorRef.current;
    if (!ed || !files.length) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const url = await uploadRef.current(file);
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
        Placeholder.configure({
          placeholder: "Текст статьи: заголовки, списки, вставка изображений…",
        }),
      ],
      content: initialHtml || "<p></p>",
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        onHtmlChange(html);
        if (onHeadingsChange) {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const hs = [...doc.querySelectorAll("h1, h2, h3")].map((el, idx) => ({
            id: `toc-${idx}`,
            text: (el.textContent || "").trim(),
            level: Number(el.tagName.slice(1)),
          }));
          onHeadingsChange(hs.filter((x) => x.text));
        }
      },
      editorProps: {
        attributes: {
          class: "kb-editor-content",
        },
        handlePaste: (_view, event) => {
          if (!editableRef.current) return false;
          const files = collectClipboardImageFiles(event);
          if (!files.length) return false;
          event.preventDefault();
          void insertImagesFromFiles(files);
          return true;
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
    [articleKey, insertImagesFromFiles],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  /** Только при смене статьи / remount ключа — не при каждом обновлении html из родителя (иначе сбрасывается курсор). */
  useEffect(() => {
    if (!editor) return;
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
    if (!ed) return;
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
    if (!ed) return;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinkModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [linkModalOpen]);

  if (!editor) {
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
        <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Скриншот: вставьте в текст (<kbd className="rounded bg-slate-100 px-1 dark:bg-slate-800">Ctrl+V</kbd>) или перетащите файл в
          область редактора.
        </p>
      )}
      {!editable && (
        <p className="border-b border-slate-100 bg-slate-50/80 px-3 py-1.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          Просмотр: редактирование в этом пространстве для вас недоступно.
        </p>
      )}
      <EditorContent editor={editor} className="min-h-[min(70vh,520px)] bg-white px-1 dark:bg-slate-900/50" />

      {linkModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kb-link-dialog-title"
          onClick={() => setLinkModalOpen(false)}
        >
          <div
            className="glass w-full max-w-md rounded-2xl p-5 shadow-soft-lg dark:border-slate-600"
            onClick={(e) => e.stopPropagation()}
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
                onClick={() => setLinkModalOpen(false)}
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
