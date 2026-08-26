"""Доступ к справочнику УСПД: суперпользователь или сотрудник СМЗиС (ЗФ и НТЭК)."""

from __future__ import annotations

import re

from app.models import User

_SMZIS_SLUG = "smzis"


def _fold(value: str) -> str:
    text = (value or "").casefold().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9]+", "", text)


def is_smzis_zf_ntek_system(name: str | None, slug: str | None) -> bool:
    if (slug or "").strip().casefold() == _SMZIS_SLUG:
        return True
    blob = _fold(name or "")
    return "смзис" in blob and ("зф" in blob or "нтэк" in blob)


def user_can_access_uspd(user: User) -> bool:
    if user.is_superuser:
        return True
    for membership in user.system_memberships:
        system = membership.system
        if system and is_smzis_zf_ntek_system(system.name, system.slug):
            return True
    return False
