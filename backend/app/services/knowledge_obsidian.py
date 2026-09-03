"""Parse Obsidian markdown notes into knowledge-base HTML, remapping images."""

from __future__ import annotations

import io
import re
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

import markdown as md_lib

MD_EXTS = {".md", ".markdown", ".txt"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
SKIP_PATH_PARTS = {".obsidian", ".trash", ".git", "__macosx"}
SKIP_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}

_IMAGE_CT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}

_CYR = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "sch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
}

_WIKI_EMBED = re.compile(r"!\[\[([^\]\n]+?)\]\]")
_WIKI_LINK = re.compile(r"(?<!!)\[\[([^\]\n]+?)\]\]")
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\n]+)\)")
_HTML_IMG_SRC = re.compile(r'(<img\b[^>]*\bsrc\s*=\s*)(["\'])([^"\']+)\2', re.I)
_FRONTMATTER = re.compile(r"\A---\s*\n.*?\n---\s*\n?", re.S)
_COMMENT = re.compile(r"%%.*?%%", re.S)


@dataclass
class ParsedNote:
    title: str
    html: str
    missing_images: list[str]
    images_rewritten: int


@dataclass
class ImportItems:
    notes: list[tuple[str, str]] = field(default_factory=list)
    images: list[tuple[str, bytes, str]] = field(default_factory=list)


def upload_kind(filename: str) -> str | None:
    """'note' | 'image' | None (skip)."""
    rel = normalize_relpath(filename)
    if not rel:
        return None
    if Path(rel).name.lower() in SKIP_NAMES:
        return None
    parts = {p.lower() for p in rel.split("/")}
    if parts & SKIP_PATH_PARTS:
        return None
    ext = Path(rel).suffix.lower()
    if ext in MD_EXTS:
        return "note"
    if ext in IMAGE_EXTS:
        return "image"
    return None


def add_import_bytes(
    items: ImportItems,
    filename: str,
    raw: bytes,
    *,
    declared_type: str | None = None,
    max_md_bytes: int,
    max_image_bytes: int,
) -> None:
    kind = upload_kind(filename)
    if kind is None:
        return
    rel = normalize_relpath(filename) or filename
    if kind == "note":
        if len(raw) > max_md_bytes:
            items.notes.append((rel, ""))
            return
        try:
            items.notes.append((rel, raw.decode("utf-8-sig")))
        except UnicodeDecodeError:
            items.notes.append((rel, ""))
        return
    if len(raw) > max_image_bytes:
        return
    ct = image_content_type(rel, declared_type)
    if ct:
        items.images.append((rel, raw, ct))


def unpack_obsidian_zip(
    source: bytes | str,
    *,
    max_md_bytes: int,
    max_image_bytes: int,
    max_files: int,
    max_uncompressed: int,
) -> ImportItems:
    items = ImportItems()
    try:
        zf = zipfile.ZipFile(io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source)
    except zipfile.BadZipFile as exc:
        raise ValueError("Не удалось открыть zip (повреждён или это не архив)") from exc
    total = 0
    used = 0
    with zf:
        for info in zf.infolist():
            if info.is_dir() or info.file_size <= 0:
                continue
            rel = normalize_relpath(info.filename)
            if not rel:
                continue
            kind = upload_kind(rel)
            if kind is None:
                continue
            if used >= max_files:
                raise ValueError(f"В архиве слишком много заметок и картинок (макс. {max_files})")
            cap = max_md_bytes if kind == "note" else max_image_bytes
            if info.file_size > cap:
                if kind == "note":
                    items.notes.append((rel, ""))
                    used += 1
                continue
            total += info.file_size
            if total > max_uncompressed:
                raise ValueError("Архив слишком большой после распаковки")
            add_import_bytes(
                items,
                rel,
                zf.read(info),
                max_md_bytes=max_md_bytes,
                max_image_bytes=max_image_bytes,
            )
            used += 1
    if not items.notes and not items.images:
        raise ValueError("В архиве нет .md и картинок (png/jpg/gif/webp)")
    return items


def normalize_relpath(path: str) -> str:
    raw = unquote((path or "").replace("\\", "/").strip())
    parts: list[str] = []
    for part in raw.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def basename_key(path: str) -> str:
    return Path(normalize_relpath(path)).name.lower()


def image_content_type(filename: str, declared: str | None = None) -> str | None:
    ct = (declared or "").split(";")[0].strip().lower()
    if ct in _IMAGE_CT.values():
        return ct
    ext = Path(filename or "").suffix.lower()
    return _IMAGE_CT.get(ext)


def title_from_filename(filename: str) -> str:
    stem = Path(normalize_relpath(filename) or filename or "").name
    stem = re.sub(r"\.(md|markdown|txt)$", "", stem, flags=re.I)
    return " ".join(stem.replace("_", " ").split()).strip() or "Без названия"


def folder_title_from_segment(seg: str) -> str:
    return " ".join((seg or "").replace("_", " ").split()).strip() or (seg or "Папка")


def detect_common_root(note_filenames: list[str]) -> str:
    """Zip of a vault folder wraps everything in one root dir — strip it for the KB tree."""
    firsts: list[str] = []
    for fn in note_filenames:
        parts = [p for p in normalize_relpath(fn).split("/") if p]
        if len(parts) < 2:
            return ""
        firsts.append(parts[0])
    if not firsts:
        return ""
    if len({name.lower() for name in firsts}) != 1:
        return ""
    return firsts[0]


def note_folder_segments(filename: str, common_root: str = "") -> list[str]:
    parts = [p for p in normalize_relpath(filename).split("/") if p]
    if common_root and parts and parts[0].lower() == common_root.lower():
        parts = parts[1:]
    if len(parts) <= 1:
        return []
    return parts[:-1]


def slugify_title(input_text: str, fallback: str = "article") -> str:
    out: list[str] = []
    for ch in (input_text or "").lower():
        if ch in _CYR:
            out.append(_CYR[ch])
        else:
            out.append(ch)
    raw = "".join(out)
    raw = re.sub(r"['\"`]", "", raw)
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or fallback


def unique_slug(base: str, taken: set[str], fallback: str = "article") -> str:
    candidate = (base or fallback).lower()
    if candidate not in taken:
        return candidate
    n = 2
    while f"{candidate}-{n}" in taken:
        n += 1
    return f"{candidate}-{n}"


_HUB_TITLES = ("оглавление", "главная", "главная страница", "home", "index")


def normalize_hub_title(title: str) -> str:
    return " ".join((title or "").strip().lower().replace("ё", "е").split())


def is_import_hub_title(title: str) -> bool:
    t = normalize_hub_title(title)
    if not t:
        return False
    if t in _HUB_TITLES:
        return True
    return t.startswith("оглавлен")


def find_space_import_hub(
    rows: list[tuple[object, str | None, object, object]],
) -> tuple[uuid.UUID, str] | None:
    """Корневая страница пространства вроде «Главная» / «Оглавление» — под неё кладём импорт."""
    roots: list[tuple[object, str, int]] = []
    for aid, title, parent_id, _slug in rows:
        if parent_id is not None:
            continue
        raw = (title or "").strip()
        if not is_import_hub_title(raw):
            continue
        t = normalize_hub_title(raw)
        try:
            rank = _HUB_TITLES.index(t)
        except ValueError:
            rank = 50
        roots.append((aid, raw, rank))
    if not roots:
        return None
    roots.sort(key=lambda item: (item[2], normalize_hub_title(item[1])))
    aid, title, _rank = roots[0]
    return uuid.UUID(str(aid)), title


def parse_note(
    filename: str,
    text: str,
    url_by_path: dict[str, str],
    url_by_name: dict[str, str],
) -> ParsedNote:
    title = title_from_filename(filename)
    body = _COMMENT.sub("", text or "")
    body = _FRONTMATTER.sub("", body, count=1).strip("\n")
    body = _convert_wiki_syntax(body)
    body, rewritten_md, missing = rewrite_markdown_images(body, filename, url_by_path, url_by_name)
    html = markdown_to_html(body)
    html, rewritten_html, missing_html = rewrite_html_images(html, filename, url_by_path, url_by_name)
    missing = list(dict.fromkeys([*missing, *missing_html]))
    return ParsedNote(
        title=title,
        html=_sanitize_html(html),
        missing_images=missing,
        images_rewritten=rewritten_md + rewritten_html,
    )


def markdown_to_html(text: str) -> str:
    return md_lib.markdown(
        text or "",
        extensions=["extra", "sane_lists", "nl2br"],
    )


def rewrite_markdown_images(
    text: str,
    md_filename: str,
    url_by_path: dict[str, str],
    url_by_name: dict[str, str],
) -> tuple[str, int, list[str]]:
    missing: list[str] = []
    rewritten = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal rewritten
        alt, raw_src = match.group(1), match.group(2)
        src = _clean_src(raw_src)
        url = resolve_image(src, md_filename, url_by_path, url_by_name)
        if url:
            rewritten += 1 if url != src else 0
            return f"![{alt}]({url})"
        missing.append(src)
        name = Path(src).name or src
        label = f"{alt.strip()} ({name})" if alt.strip() else name
        return f"\n\n> 📎 Изображение «{label}» не приложено к импорту.\n\n"

    return _MD_IMAGE.sub(repl, text), rewritten, missing


def rewrite_html_images(
    html: str,
    md_filename: str,
    url_by_path: dict[str, str],
    url_by_name: dict[str, str],
) -> tuple[str, int, list[str]]:
    missing: list[str] = []
    rewritten = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal rewritten
        prefix, quote, raw_src = match.group(1), match.group(2), match.group(3)
        src = _clean_src(raw_src)
        url = resolve_image(src, md_filename, url_by_path, url_by_name)
        if url:
            if url != src:
                rewritten += 1
            return f"{prefix}{quote}{url}{quote}"
        missing.append(src)
        return match.group(0)

    return _HTML_IMG_SRC.sub(repl, html or ""), rewritten, missing


def resolve_image(
    src: str,
    md_filename: str,
    url_by_path: dict[str, str],
    url_by_name: dict[str, str],
) -> str | None:
    if _is_already_hosted(src):
        return src
    if re.match(r"^(https?:|data:|file:|//)", src, re.I):
        return None
    md_dir = str(PurePosixPath(normalize_relpath(md_filename)).parent)
    joined = normalize_relpath(f"{md_dir}/{src}" if md_dir not in ("", ".") else src)
    key = joined.lower()
    if key in url_by_path:
        return url_by_path[key]
    name = basename_key(src)
    if name in url_by_name:
        return url_by_name[name]
    return None


def _convert_wiki_syntax(text: str) -> str:
    def embed(match: re.Match[str]) -> str:
        raw = match.group(1)
        target, alias = (raw.split("|", 1) + [""])[:2]
        target = target.strip()
        if Path(target.split("#", 1)[0]).suffix.lower() in IMAGE_EXTS:
            alt = alias.strip()
            src = target.split("#", 1)[0].strip()
            return f"![{alt}]({src})"
        if alias.strip():
            return alias.strip()
        return target.split("#", 1)[0].strip()

    def link(match: re.Match[str]) -> str:
        raw = match.group(1)
        if "|" in raw:
            _target, alias = raw.split("|", 1)
            return alias.strip()
        return raw.split("#", 1)[0].strip()

    out = _WIKI_EMBED.sub(embed, text)
    return _WIKI_LINK.sub(link, out)


def _clean_src(raw: str) -> str:
    src = (raw or "").strip()
    if src.startswith("<") and ">" in src:
        src = src[1 : src.index(">")].strip()
    else:
        # Markdown optional title: url "title" / url 'title' — keep spaces in the path.
        src = re.sub(r"""\s+("([^"]*)"|'([^']*)')\s*$""", "", src).strip()
    src = src.strip("\"'")
    try:
        src = unquote(src)
    except Exception:  # noqa: BLE001
        pass
    return src


def _is_already_hosted(src: str) -> bool:
    s = src.strip()
    return (
        s.startswith("/mes/files/")
        or s.startswith("/files/")
        or s.startswith("/uploads/")
        or s.startswith("/mes/uploads/")
        or s.startswith("data:image/")
    )


def _sanitize_html(html: str) -> str:
    out = re.sub(r"(?is)<script[^>]*>.*?</script>", "", html or "")
    out = re.sub(r"(?is)<iframe[^>]*>.*?</iframe>", "", out)
    out = re.sub(r"(?is)<object[^>]*>.*?</object>", "", out)
    out = re.sub(r"\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", out, flags=re.I)
    out = re.sub(r"(?i)javascript:", "", out)
    return out
