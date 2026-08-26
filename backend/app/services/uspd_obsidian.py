"""Parse Obsidian markdown notes into USPD site + table rows."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

EUI_RE = re.compile(r"\b[0-9a-fA-F]{16}\b")
MD_LINK_RE = re.compile(
    r"\[([^\]]+)\]\(([^)]+)\)(?:\s*[-–—:]\s*([0-9a-fA-F]{16}))?",
)
GATEWAY_CRED_RE = re.compile(r"(?i)^(шлюз|gateway|gw|маска)\b")
KNOWN_MODELS = ("Simatic", "IROBO", "LT40")


@dataclass
class ParsedEntry:
    object: str
    model: str | None = None
    ip: str | None = None
    username: str | None = None
    password: str | None = None
    comment: str | None = None
    device_eui: str | None = None


@dataclass
class ParsedSite:
    name: str
    entries: list[ParsedEntry] = field(default_factory=list)


def site_name_from_filename(filename: str) -> str:
    stem = Path(filename or "").name
    stem = re.sub(r"\.(md|markdown|txt)$", "", stem, flags=re.I)
    return " ".join(stem.replace("_", " ").split()).strip() or "Без названия"


def parse_obsidian_note(filename: str, text: str) -> ParsedSite:
    name = site_name_from_filename(filename)
    entries = _parse_first_table(text)
    _attach_gateway_eui(entries, text)
    return ParsedSite(name=name, entries=entries)


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split()).strip()
    return text or None


def _split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _is_sep(cells: list[str]) -> bool:
    if not cells:
        return False
    ok = False
    for cell in cells:
        t = cell.replace(" ", "")
        if not t:
            continue
        if not re.fullmatch(r":?-{3,}:?", t):
            return False
        ok = True
    return ok


def _first_table_lines(text: str) -> list[str]:
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip().startswith("|"):
            start = i
            break
    if start is None:
        return []
    block: list[str] = []
    for line in lines[start:]:
        if not line.strip().startswith("|"):
            break
        block.append(line)
    return block


def _col_index(header: list[str], *names: str) -> int | None:
    lowered = [h.lower() for h in header]
    for name in names:
        for i, h in enumerate(lowered):
            if name in h:
                return i
    return None


def _parse_first_table(text: str) -> list[ParsedEntry]:
    block = _first_table_lines(text)
    if len(block) < 2:
        return []
    header = _split_row(block[0])
    rows = block[1:]
    if rows and _is_sep(_split_row(rows[0])):
        rows = rows[1:]
    obj_i = _col_index(header, "object", "объект")
    ip_i = _col_index(header, "ip", "адрес")
    cred_i = _col_index(header, "cred", "login", "учёт", "учет")
    comment_i = _col_index(header, "comment", "коммент", "примечание")
    if obj_i is None:
        obj_i = 0
        ip_i = 1 if ip_i is None and len(header) > 1 else ip_i
        cred_i = 2 if cred_i is None and len(header) > 2 else cred_i
        comment_i = 3 if comment_i is None and len(header) > 3 else comment_i
    out: list[ParsedEntry] = []
    for line in rows:
        cells = _split_row(line)
        raw_obj = _cell(cells, obj_i)
        if not raw_obj:
            continue
        object_name, model = _split_object_model(raw_obj)
        ip = _cell(cells, ip_i)
        username, password, cred_note = _parse_cred(_cell(cells, cred_i) or "")
        comment = _cell(cells, comment_i)
        eui = None
        if comment:
            found = EUI_RE.search(comment)
            if found:
                eui = found.group(0)
                comment = _blank(comment.replace(found.group(0), ""))
                comment = _blank(re.sub(r"(?i)\b(deveui|dev\s*eui|eui)\b[:\s-]*", "", comment or ""))
        if cred_note:
            comment = " · ".join(x for x in (comment, cred_note) if x)
        out.append(
            ParsedEntry(
                object=object_name,
                model=model,
                ip=ip,
                username=username,
                password=password,
                comment=comment,
                device_eui=eui.lower() if eui else None,
            )
        )
    return out


def _cell(cells: list[str], idx: int | None) -> str | None:
    if idx is None or idx < 0 or idx >= len(cells):
        return None
    return _blank(cells[idx])


def _parse_cred(cred: str) -> tuple[str | None, str | None, str | None]:
    t = cred.strip()
    if not t:
        return None, None, None
    if GATEWAY_CRED_RE.search(t):
        return None, None, t
    if "/" in t:
        user, pwd = t.split("/", 1)
        return _blank(user), _blank(pwd), None
    return t, None, None


def _split_object_model(raw: str) -> tuple[str, str | None]:
    t = " ".join(raw.split())
    low = t.lower()
    if re.match(r"(?i)^(бс|bs|gw|gateway)\b", t) or re.search(r"(?i)базов\w*\s*станц", t):
        return "БС", None
    cisco = re.match(r"(?i)^cisco\s+(.*)$", t)
    if cisco:
        rest = cisco.group(1).strip()
        if rest.lower().startswith("asa"):
            compact = re.sub(r"\s+", "", rest)
            model = None if compact.lower() == "asa" else compact
            return "Cisco ASA", model
        if rest:
            return "Cisco", rest
        return "Cisco", None
    for name in KNOWN_MODELS:
        if low == name.lower() or low.startswith(name.lower()):
            return t, name
    return t, None


def _parse_gateways(text: str) -> list[tuple[str, str | None, str | None]]:
    found: list[tuple[str, str | None, str | None]] = []
    for match in MD_LINK_RE.finditer(text):
        label, url, eui = match.group(1).strip(), match.group(2).strip(), match.group(3)
        if not eui:
            tail = EUI_RE.findall(url)
            eui = tail[-1] if tail else None
        if not eui:
            after = text[match.end() : match.end() + 80]
            extra = EUI_RE.search(after)
            eui = extra.group(0) if extra else None
        if eui or re.search(r"(?i)gateway|gateways|/gw", url):
            found.append((label, _blank(url), eui.lower() if eui else None))
    return found


def _attach_gateway_eui(entries: list[ParsedEntry], text: str) -> None:
    gateways = _parse_gateways(text)
    if not gateways:
        return
    bs_rows = [e for e in entries if e.object == "БС" and not e.device_eui]
    used = 0
    for row in bs_rows:
        if used >= len(gateways):
            break
        _label, _url, eui = gateways[used]
        used += 1
        if eui:
            row.device_eui = eui
    for label, url, eui in gateways[used:]:
        entries.append(
            ParsedEntry(
                object="БС",
                ip=url,
                comment=label,
                device_eui=eui,
            )
        )
