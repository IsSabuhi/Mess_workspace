import { Image } from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, ImagePlus, Italic, List, ListOrdered } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { uploadUspdImage } from "../api/uspd";
import { toastApiError, toastError } from "../lib/toast";

type Props = {
  value: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  compact?: boolean;
  placeholder?: string;
};

function sameMarkdown(a: string, b: string): boolean {
  return a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();
}

function looksLikeImageFile(file: File | null, declaredType?: string): file is File {
  if (!file) return false;
  const t = (file.type || declaredType || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(file.name);
}

function collectClipboardImageFiles(event: ClipboardEvent): File[] {
  const seen = new Set<File>();
  const out: File[] = [];
  const add = (f: File | null, itemType?: string) => {
    if (!looksLikeImageFile(f, itemType) || seen.has(f)) return;
    seen.add(f);
    out.push(f);
  };
  const dt = event.clipboardData;
  if (!dt) return out;
  if (dt.files?.length) {
    for (let i = 0; i < dt.files.length; i++) add(dt.files.item(i));
  }
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === "file") add(item.getAsFile(), item.type);
    }
  }
  return out;
}

function collectDataTransferImageFiles(dataTransfer: DataTransfer | null): File[] {
  const out: File[] = [];
  if (!dataTransfer?.files?.length) return out;
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const f = dataTransfer.files.item(i);
    if (looksLikeImageFile(f)) out.push(f);
  }
  return out;
}

export function MarkdownNotesEditor({
  value,
  onChange,
  editable = true,
  compact = false,
  placeholder = "Markdown: **жирный**, списки, # заголовок. Скриншот — Ctrl+V",
}: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const skipNextUpdate = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const [uploading, setUploading] = useState(false);

  const insertImagesFromFiles = useCallback(async (files: File[], insertPos?: number | null) => {
    if (!files.length) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const { url } = await uploadUspdImage(file);
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
          toastApiError(e, "Не удалось загрузить изображение");
        }
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: !editable, autolink: true },
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: "max-w-full rounded-lg" },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: true },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: [
          "kb-editor-content md-notes-content",
          compact ? "md-notes-compact" : "",
          editable ? "" : "md-notes-readonly",
        ]
          .filter(Boolean)
          .join(" "),
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
    onUpdate: ({ editor: ed }) => {
      if (skipNextUpdate.current) {
        skipNextUpdate.current = false;
        return;
      }
      if (!editable || !onChangeRef.current || ed.isDestroyed) return;
      onChangeRef.current(ed.getMarkdown());
    },
  });

  useEffect(() => {
    editorRef.current = editor && !editor.isDestroyed ? editor : null;
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = editor.getMarkdown();
    if (sameMarkdown(current, value || "")) return;
    skipNextUpdate.current = true;
    editor.commands.setContent(value || "", { contentType: "markdown" });
  }, [editor, value]);

  const pickImage = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      void insertImagesFromFiles(files);
    };
    input.click();
  }, [insertImagesFromFiles]);

  if (!editor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
        Загрузка редактора…
      </div>
    );
  }

  const btn = (active: boolean) =>
    `rounded-md p-1.5 ${
      active
        ? "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;

  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40 ${
        editable ? "" : "border-transparent bg-transparent dark:bg-transparent"
      }`}
    >
      {editable && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-1.5 py-1 dark:border-slate-700 dark:bg-slate-800/80">
          <button
            type="button"
            title="Жирный"
            className={btn(editor.isActive("bold"))}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Курсив"
            className={btn(editor.isActive("italic"))}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Заголовок"
            className={btn(editor.isActive("heading", { level: 2 }))}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Маркированный список"
            className={btn(editor.isActive("bulletList"))}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Нумерованный список"
            className={btn(editor.isActive("orderedList"))}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Картинка или скриншот"
            disabled={uploading}
            className={`${btn(false)} disabled:opacity-50`}
            onClick={() => {
              if (uploading) {
                toastError("Дождитесь загрузки предыдущего файла");
                return;
              }
              pickImage();
            }}
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <span className="ml-auto px-1.5 text-[11px] text-slate-400">
            {uploading ? "Загрузка…" : "Ctrl+V — скриншот"}
          </span>
        </div>
      )}
      <div className={editable ? "px-3 py-2" : ""}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
