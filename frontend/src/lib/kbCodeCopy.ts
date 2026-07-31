/** Кнопки «Копировать» на блоках кода (pre) в базе знаний. */

const BTN_CLASS = "kb-code-copy";
const PRE_CLASS = "kb-code-block";

function codeTextFromPre(pre: HTMLElement): string {
  const code = pre.querySelector("code");
  if (code) return code.textContent ?? "";
  // Без <code>: берём текст pre, исключая кнопку
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${BTN_CLASS}`).forEach((el) => el.remove());
  return clone.textContent ?? "";
}

async function copyPreCode(btn: HTMLButtonElement): Promise<void> {
  const pre = btn.closest("pre");
  if (!(pre instanceof HTMLElement)) return;
  const text = codeTextFromPre(pre);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const prev = btn.textContent;
  btn.textContent = "Скопировано";
  btn.classList.add("kb-code-copy--done");
  window.setTimeout(() => {
    btn.textContent = prev || "Копировать";
    btn.classList.remove("kb-code-copy--done");
  }, 1600);
}

function ensureCopyButton(pre: HTMLElement): void {
  if (pre.querySelector(`:scope > .${BTN_CLASS}`)) return;
  pre.classList.add(PRE_CLASS);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BTN_CLASS;
  btn.textContent = "Копировать";
  btn.setAttribute("aria-label", "Скопировать код");
  btn.setAttribute("contenteditable", "false");
  btn.tabIndex = -1;
  btn.addEventListener("mousedown", (e) => {
    // Не уводить фокус/выделение в редакторе
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void copyPreCode(btn);
  });
  pre.appendChild(btn);
}

/**
 * Вешает кнопки копирования на все <pre> внутри root.
 * Следит за изменениями DOM (TipTap / подсветка) и возвращает cleanup.
 */
export function attachCodeCopyButtons(root: HTMLElement | null): () => void {
  if (!root) return () => undefined;

  const decorate = () => {
    root.querySelectorAll("pre").forEach((node) => {
      if (node instanceof HTMLElement) ensureCopyButton(node);
    });
  };

  decorate();

  const mo = new MutationObserver(() => {
    decorate();
  });
  mo.observe(root, { childList: true, subtree: true });

  return () => {
    mo.disconnect();
    root.querySelectorAll(`.${BTN_CLASS}`).forEach((el) => el.remove());
    root.querySelectorAll(`.${PRE_CLASS}`).forEach((el) => el.classList.remove(PRE_CLASS));
  };
}
