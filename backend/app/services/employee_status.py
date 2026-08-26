"""Фильтр «не уволен» для списков текущего персонала."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.sql.elements import ColumnElement

from app.models.employee_profile import EmployeeProfile
from app.models.user import User


def user_is_not_dismissed() -> ColumnElement[bool]:
    """True, если у сотрудника нет отметки «уволен» в кадровом профиле."""
    dismissed_ids = select(EmployeeProfile.user_id).where(EmployeeProfile.is_dismissed.is_(True))
    return User.id.not_in(dismissed_ids)
