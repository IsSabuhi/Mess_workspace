import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import get_current_uspd_user, require_any_permission
from app.models import User
from app.permissions import ADMIN_IMPORT_USPD
from app.models.uspd import UspdEntry, UspdHwModel, UspdSite
from app.schemas.common import Message
from app.schemas.upload import UploadOut
from app.schemas.uspd import (
    UspdEntryOut,
    UspdEntryWrite,
    UspdHwModelOut,
    UspdHwModelWrite,
    UspdObsidianFileResult,
    UspdObsidianImportOut,
    UspdSimExcelImportOut,
    UspdSimExcelRowResult,
    UspdSiteOut,
    UspdSiteUpdate,
    UspdSiteWrite,
)
from app.services.audit import record_audit_event
from app.services.file_storage import save_uspd_image
from app.services.secret_crypto import decrypt_secret, encrypt_secret
from app.services.sql_like import ilike_contains, ilike_escape_char
from app.services.uspd_obsidian import parse_obsidian_note
from app.services.uspd_sim_excel import extract_ipv4, is_gsm_object, parse_uspd_sim_excel

router = APIRouter(prefix="/uspd", tags=["uspd"])
_USPD = get_current_uspd_user
_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_ALLOWED_IMAGE_CT = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}


def _sniff_image_content_type(raw: bytes, declared: str) -> str:
    if declared == "image/jpg":
        return "image/jpeg"
    if declared in _ALLOWED_IMAGE_CT:
        return declared
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a"):
        return "image/gif"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return declared


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


async def _ensure_hw_model(session: AsyncSession, name: str | None) -> UspdHwModel | None:
    text = _blank(name)
    if not text:
        return None
    text = text[:128]
    existing = await session.scalar(
        select(UspdHwModel).where(func.lower(UspdHwModel.name) == text.lower())
    )
    if existing:
        return existing
    row = UspdHwModel(name=text)
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
        return row
    except IntegrityError:
        existing = await session.scalar(
            select(UspdHwModel).where(func.lower(UspdHwModel.name) == text.lower())
        )
        if existing:
            return existing
        raise


def _entry_out(row: UspdEntry) -> UspdEntryOut:
    return UspdEntryOut(
        id=row.id,
        parent_id=row.parent_id,
        object=row.object_name or "",
        model=row.hw_model,
        device_eui=row.device_eui,
        ip=row.ip,
        username=row.username,
        password=decrypt_secret(row.password_encrypted),
        comment=row.comment,
        section=row.section,
        sim_number=row.sim_number,
        sim_ip=row.sim_ip,
        sim_iccid=row.sim_iccid,
        sim_pin=decrypt_secret(row.sim_pin_encrypted),
        sim_puk=decrypt_secret(row.sim_puk_encrypted),
        sort_order=row.sort_order,
    )


def _site_out(row: UspdSite) -> UspdSiteOut:
    return UspdSiteOut(
        id=row.id,
        name=row.name,
        notes=row.notes,
        system_id=row.system_id,
        entries=[_entry_out(x) for x in row.entries],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _get_site(session: AsyncSession, site_id: uuid.UUID) -> UspdSite:
    row = await session.scalar(
        select(UspdSite).options(selectinload(UspdSite.entries)).where(UspdSite.id == site_id)
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Объект не найден")
    return row


@router.get("", response_model=list[UspdSiteOut])
async def list_sites(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_USPD)],
    q: str = Query("", max_length=200),
) -> list[UspdSiteOut]:
    stmt = select(UspdSite).options(selectinload(UspdSite.entries))
    like = ilike_contains(q)
    if like:
        esc = ilike_escape_char()
        stmt = stmt.where(
            or_(
                UspdSite.name.ilike(like, escape=esc),
                UspdSite.notes.ilike(like, escape=esc),
                exists()
                .where(UspdEntry.site_id == UspdSite.id)
                .where(
                    or_(
                        UspdEntry.object_name.ilike(like, escape=esc),
                        UspdEntry.hw_model.ilike(like, escape=esc),
                        UspdEntry.device_eui.ilike(like, escape=esc),
                        UspdEntry.ip.ilike(like, escape=esc),
                        UspdEntry.username.ilike(like, escape=esc),
                        UspdEntry.comment.ilike(like, escape=esc),
                        UspdEntry.section.ilike(like, escape=esc),
                        UspdEntry.sim_number.ilike(like, escape=esc),
                        UspdEntry.sim_ip.ilike(like, escape=esc),
                        UspdEntry.sim_iccid.ilike(like, escape=esc),
                    )
                ),
            )
        )
    stmt = stmt.order_by(UspdSite.name)
    rows = (await session.scalars(stmt)).all()
    return [_site_out(site) for site in rows]


@router.get("/models", response_model=list[UspdHwModelOut])
async def list_hw_models(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_USPD)],
) -> list[UspdHwModelOut]:
    rows = (
        await session.scalars(select(UspdHwModel).order_by(func.lower(UspdHwModel.name)))
    ).all()
    return [UspdHwModelOut.model_validate(row) for row in rows]


@router.post("/models", response_model=UspdHwModelOut, status_code=status.HTTP_201_CREATED)
async def create_hw_model(
    body: UspdHwModelWrite,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> UspdHwModelOut:
    before = await session.scalar(
        select(UspdHwModel).where(func.lower(UspdHwModel.name) == body.name.strip().lower())
    )
    row = await _ensure_hw_model(session, body.name)
    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Укажите название модели")
    if before is None:
        await record_audit_event(
            session,
            entity_type="uspd",
            entity_id=row.id,
            action="uspd.model.created",
            actor_user_id=user.id,
            details={"name": row.name},
        )
    return UspdHwModelOut.model_validate(row)


@router.post("/upload", response_model=UploadOut)
async def upload_uspd_image(
    file: Annotated[UploadFile, File()],
    _: Annotated[User, Depends(_USPD)],
) -> UploadOut:
    """Картинка или скриншот для заметок объекта УСПД."""
    declared = (file.content_type or "").split(";")[0].strip().lower()
    raw = await file.read()
    if len(raw) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл больше 8 МБ")
    ct = _sniff_image_content_type(raw, declared)
    if ct not in _ALLOWED_IMAGE_CT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нужен файл изображения (png, jpg, gif, webp)",
        )
    return UploadOut(url=save_uspd_image(raw, ct))


@router.post("/import-obsidian", response_model=UspdObsidianImportOut)
async def import_obsidian(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_any_permission(ADMIN_IMPORT_USPD))],
    files: Annotated[list[UploadFile], File(..., description="Один или несколько .md из Obsidian")],
) -> UspdObsidianImportOut:
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Выберите хотя бы один файл")
    if len(files) > 200:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Слишком много файлов за раз (макс. 200)")
    results: list[UspdObsidianFileResult] = []
    created = skipped = failed = 0
    for upload in files:
        filename = upload.filename or "без имени.md"
        try:
            raw = await upload.read()
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("Файл больше 2 МБ")
            lower = filename.lower()
            if not (lower.endswith(".md") or lower.endswith(".markdown") or lower.endswith(".txt")):
                raise ValueError("Ожидается файл .md")
            text = raw.decode("utf-8-sig")
            parsed = parse_obsidian_note(filename, text)
            if not parsed.name:
                raise ValueError("Не удалось определить имя объекта")
            exists_id = await session.scalar(
                select(UspdSite.id).where(func.lower(UspdSite.name) == parsed.name.lower())
            )
            if exists_id:
                skipped += 1
                results.append(
                    UspdObsidianFileResult(
                        filename=filename,
                        site_name=parsed.name,
                        skipped=True,
                        error="Объект с таким именем уже есть",
                    )
                )
                continue
            if not parsed.entries:
                raise ValueError("В файле нет таблицы Object / Ip / Cred / Comment")
            async with session.begin_nested():
                site = UspdSite(name=parsed.name)
                session.add(site)
                await session.flush()
                for i, item in enumerate(parsed.entries, start=1):
                    catalog = await _ensure_hw_model(session, item.model)
                    session.add(
                        UspdEntry(
                            site_id=site.id,
                            object_name=item.object,
                            hw_model=catalog.name if catalog else None,
                            device_eui=_blank(item.device_eui),
                            ip=_blank(item.ip),
                            username=_blank(item.username),
                            password_encrypted=encrypt_secret(item.password),
                            comment=_blank(item.comment),
                            sort_order=i,
                        )
                    )
                await session.flush()
                await record_audit_event(
                    session,
                    entity_type="uspd",
                    entity_id=site.id,
                    action="uspd.imported",
                    actor_user_id=user.id,
                    details={"name": site.name, "file": filename, "entries": len(parsed.entries)},
                )
            created += 1
            results.append(
                UspdObsidianFileResult(
                    filename=filename,
                    site_name=parsed.name,
                    created=True,
                    entries=len(parsed.entries),
                )
            )
        except Exception as exc:  # noqa: BLE001 — отчёт по файлу, остальные продолжаем
            failed += 1
            results.append(
                UspdObsidianFileResult(
                    filename=filename,
                    error=str(exc) or "Не удалось разобрать файл",
                )
            )
    return UspdObsidianImportOut(created=created, skipped=skipped, failed=failed, files=results)


@router.post("/import-sim-excel", response_model=UspdSimExcelImportOut)
async def import_sim_excel(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_any_permission(ADMIN_IMPORT_USPD))],
    file: Annotated[UploadFile, File(..., description="Excel .xlsx со SIM: H телефон, K ICCID, Q IP, R адрес")],
) -> UspdSimExcelImportOut:
    fname = (file.filename or "").lower()
    if not fname.endswith(".xlsx"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ожидается файл .xlsx")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Файл больше 10 МБ")
    parsed, err = parse_uspd_sim_excel(content)
    if err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    entries = (
        await session.scalars(select(UspdEntry).options(selectinload(UspdEntry.site)))
    ).all()
    gsm_by_ip: dict[str, list[UspdEntry]] = {}
    children: dict[uuid.UUID, list[UspdEntry]] = {}
    next_ord: dict[uuid.UUID, int] = {}
    for row in entries:
        if row.parent_id is None:
            if is_gsm_object(row.object_name):
                for ip in extract_ipv4(row.ip):
                    gsm_by_ip.setdefault(ip, []).append(row)
            continue
        children.setdefault(row.parent_id, []).append(row)
        cur = next_ord.get(row.parent_id, 0)
        if row.sort_order > cur:
            next_ord[row.parent_id] = row.sort_order

    def _is_dup(parent_id: uuid.UUID, phone: str | None, iccid: str | None, ip: str | None) -> bool:
        for child in children.get(parent_id, []):
            if iccid and (child.sim_iccid or "").strip() == iccid:
                return True
            if phone and (child.sim_number or "").strip() == phone:
                return True
            if ip and (child.sim_ip or "").strip() == ip and not iccid and not phone:
                return True
        return False

    created = skipped = unmatched = empty = 0
    results: list[UspdSimExcelRowResult] = []
    for item in parsed:
        ips = extract_ipv4(item.ip)
        if not ips:
            empty += 1
            results.append(
                UspdSimExcelRowResult(
                    sheet_row=item.sheet_row,
                    phone=item.phone,
                    ip=item.ip,
                    status="empty",
                    error="Нет IP в колонке Q",
                )
            )
            continue
        parents: list[UspdEntry] = []
        seen: set[uuid.UUID] = set()
        for ip in ips:
            for gsm in gsm_by_ip.get(ip, []):
                if gsm.id in seen:
                    continue
                seen.add(gsm.id)
                parents.append(gsm)
        if not parents:
            unmatched += 1
            results.append(
                UspdSimExcelRowResult(
                    sheet_row=item.sheet_row,
                    phone=item.phone,
                    ip=item.ip,
                    status="unmatched",
                    error="Нет GSM с таким IP",
                )
            )
            continue
        linked_names: list[str] = []
        did_create = False
        did_skip = False
        for gsm in parents:
            if _is_dup(gsm.id, item.phone, item.iccid, item.ip):
                did_skip = True
                continue
            nxt = next_ord.get(gsm.id, 0) + 1
            next_ord[gsm.id] = nxt
            child = UspdEntry(
                site_id=gsm.site_id,
                parent_id=gsm.id,
                object_name="SIM",
                sim_number=_blank(item.phone),
                sim_iccid=_blank(item.iccid),
                sim_ip=_blank(item.ip),
                comment=_blank(item.address),
                section=gsm.section,
                sort_order=nxt,
            )
            session.add(child)
            children.setdefault(gsm.id, []).append(child)
            did_create = True
            linked_names.append(gsm.site.name if gsm.site else "")
        if did_create:
            created += 1
            results.append(
                UspdSimExcelRowResult(
                    sheet_row=item.sheet_row,
                    phone=item.phone,
                    ip=item.ip,
                    site_name=", ".join(n for n in linked_names if n) or None,
                    status="created",
                )
            )
        elif did_skip:
            skipped += 1
            results.append(
                UspdSimExcelRowResult(
                    sheet_row=item.sheet_row,
                    phone=item.phone,
                    ip=item.ip,
                    site_name=parents[0].site.name if parents[0].site else None,
                    status="skipped",
                    error="Такая SIM уже есть у этого GSM",
                )
            )

    if created:
        await record_audit_event(
            session,
            entity_type="uspd",
            entity_id=None,
            action="uspd.sim.imported",
            actor_user_id=user.id,
            details={"created": created, "skipped": skipped, "unmatched": unmatched},
        )
    return UspdSimExcelImportOut(
        created=created,
        skipped=skipped,
        unmatched=unmatched,
        empty=empty,
        rows=results,
    )


@router.post("", response_model=UspdSiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(
    body: UspdSiteWrite,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> UspdSiteOut:
    row = UspdSite(name=body.name.strip(), notes=_blank(body.notes))
    session.add(row)
    await session.flush()
    await record_audit_event(
        session,
        entity_type="uspd",
        entity_id=row.id,
        action="uspd.created",
        actor_user_id=user.id,
        details={"name": row.name},
    )
    return _site_out(await _get_site(session, row.id))


@router.get("/{site_id}", response_model=UspdSiteOut)
async def get_site(
    site_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(_USPD)],
) -> UspdSiteOut:
    return _site_out(await _get_site(session, site_id))


@router.patch("/{site_id}", response_model=UspdSiteOut)
async def update_site(
    site_id: uuid.UUID,
    body: UspdSiteUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> UspdSiteOut:
    row = await session.get(UspdSite, site_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Объект не найден")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        row.name = data["name"].strip()
    if "notes" in data:
        row.notes = _blank(data["notes"])
    await session.flush()
    await record_audit_event(
        session,
        entity_type="uspd",
        entity_id=row.id,
        action="uspd.updated",
        actor_user_id=user.id,
        details={"name": row.name},
    )
    return _site_out(await _get_site(session, row.id))


@router.delete("/{site_id}", response_model=Message)
async def delete_site(
    site_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> Message:
    row = await session.get(UspdSite, site_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Объект не найден")
    name = row.name
    await session.delete(row)
    await record_audit_event(
        session,
        entity_type="uspd",
        entity_id=site_id,
        action="uspd.deleted",
        actor_user_id=user.id,
        details={"name": name},
    )
    return Message(detail="Объект удалён")


async def _resolve_parent(
    session: AsyncSession, site_id: uuid.UUID, parent_id: uuid.UUID | None
) -> UspdEntry | None:
    if parent_id is None:
        return None
    parent = await session.scalar(
        select(UspdEntry).where(UspdEntry.id == parent_id, UspdEntry.site_id == site_id)
    )
    if not parent:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Родительская строка не найдена")
    if parent.parent_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Подстроку нельзя вкладывать в подстроку")
    return parent


@router.post("/{site_id}/entries", response_model=UspdEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    site_id: uuid.UUID,
    body: UspdEntryWrite,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> UspdEntryOut:
    site = await session.get(UspdSite, site_id)
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Объект не найден")
    parent = await _resolve_parent(session, site_id, body.parent_id)
    catalog = await _ensure_hw_model(session, body.model)
    max_ord = await session.scalar(
        select(func.max(UspdEntry.sort_order)).where(
            UspdEntry.site_id == site_id,
            UspdEntry.parent_id == (parent.id if parent else None),
        )
    )
    row = UspdEntry(
        site_id=site_id,
        parent_id=parent.id if parent else None,
        object_name=(body.object or "").strip(),
        hw_model=catalog.name if catalog else None,
        device_eui=_blank(body.device_eui),
        ip=_blank(body.ip),
        username=_blank(body.username),
        password_encrypted=encrypt_secret(body.password),
        comment=_blank(body.comment),
        section=_blank(body.section) or (parent.section if parent else None),
        sim_number=_blank(body.sim_number),
        sim_ip=_blank(body.sim_ip),
        sim_iccid=_blank(body.sim_iccid),
        sim_pin_encrypted=encrypt_secret(body.sim_pin),
        sim_puk_encrypted=encrypt_secret(body.sim_puk),
        sort_order=body.sort_order if body.sort_order is not None else int(max_ord or 0) + 1,
    )
    session.add(row)
    await session.flush()
    await record_audit_event(
        session,
        entity_type="uspd",
        entity_id=site_id,
        action="uspd.entry.created",
        actor_user_id=user.id,
        details={"name": site.name, "object": row.object_name},
    )
    return _entry_out(row)


@router.patch("/{site_id}/entries/{entry_id}", response_model=UspdEntryOut)
async def update_entry(
    site_id: uuid.UUID,
    entry_id: uuid.UUID,
    body: UspdEntryWrite,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> UspdEntryOut:
    row = await session.scalar(select(UspdEntry).where(UspdEntry.id == entry_id, UspdEntry.site_id == site_id))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Строка не найдена")
    data = body.model_dump(exclude_unset=True)
    if "object" in data:
        row.object_name = (data["object"] or "").strip()
    if "model" in data:
        catalog = await _ensure_hw_model(session, data["model"])
        row.hw_model = catalog.name if catalog else None
    for field in ("ip", "username", "comment", "section", "sim_number", "sim_ip", "sim_iccid", "device_eui"):
        if field in data:
            setattr(row, field, _blank(data[field]))
    if "sort_order" in data and data["sort_order"] is not None:
        row.sort_order = data["sort_order"]
    if "password" in data:
        row.password_encrypted = encrypt_secret(data["password"])
    if "sim_pin" in data:
        row.sim_pin_encrypted = encrypt_secret(data["sim_pin"])
    if "sim_puk" in data:
        row.sim_puk_encrypted = encrypt_secret(data["sim_puk"])
    if "parent_id" in data:
        parent = await _resolve_parent(session, site_id, data["parent_id"])
        row.parent_id = parent.id if parent else None
    await session.flush()
    await record_audit_event(
        session,
        entity_type="uspd",
        entity_id=site_id,
        action="uspd.entry.updated",
        actor_user_id=user.id,
        details={},
    )
    return _entry_out(row)


@router.delete("/{site_id}/entries/{entry_id}", response_model=Message)
async def delete_entry(
    site_id: uuid.UUID,
    entry_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(_USPD)],
) -> Message:
    row = await session.scalar(select(UspdEntry).where(UspdEntry.id == entry_id, UspdEntry.site_id == site_id))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Строка не найдена")
    await session.delete(row)
    await record_audit_event(
        session,
        entity_type="uspd",
        entity_id=site_id,
        action="uspd.entry.deleted",
        actor_user_id=user.id,
        details={},
    )
    return Message(detail="Строка удалена")
