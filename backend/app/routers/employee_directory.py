import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_permission
from app.models import EmployeeProfile, User, UserSystem
from app.permissions import EMPLOYEE_DIRECTORY_MANAGE, EMPLOYEE_DIRECTORY_READ
from app.schemas.employee_directory import EmployeeDirectoryPatch, EmployeeDirectoryRowOut
from app.schemas.position import PositionBrief
from app.schemas.system import SystemBrief

router = APIRouter(prefix="/employee-directory", tags=["employee-directory"])


def _row_to_out(user: User) -> EmployeeDirectoryRowOut:
    p = user.employee_profile
    systems = [SystemBrief.model_validate(m.system) for m in user.system_memberships if m.system]
    return EmployeeDirectoryRowOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        is_active=user.is_active,
        position=PositionBrief.model_validate(user.position) if user.position else None,
        systems=systems,
        exam_electrical_passed=bool(p.exam_electrical_passed) if p else False,
        exam_electrical_date=p.exam_electrical_date if p else None,
        exam_electrical_valid_to=p.exam_electrical_valid_to if p else None,
        pass_has=bool(p.pass_has) if p else False,
        pass_number=p.pass_number if p else None,
        pass_valid_from=p.pass_valid_from if p else None,
        pass_valid_to=p.pass_valid_to if p else None,
        notes=p.notes if p else None,
    )


@router.get("", response_model=list[EmployeeDirectoryRowOut])
async def list_employee_directory(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(EMPLOYEE_DIRECTORY_READ))],
    search: str | None = None,
    system_id: uuid.UUID | None = None,
    position_id: uuid.UUID | None = None,
    exam_electrical_passed: bool | None = None,
    pass_has: bool | None = None,
    exam_valid_to_from: date | None = None,
    exam_valid_to_to: date | None = None,
    pass_valid_to_from: date | None = None,
    pass_valid_to_to: date | None = None,
    expiring_in_days: int | None = None,
    expired_only: bool = False,
    include_inactive_users: bool = False,
) -> list[EmployeeDirectoryRowOut]:
    stmt = (
        select(User)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .options(
            selectinload(User.position),
            selectinload(User.employee_profile),
            selectinload(User.system_memberships).selectinload(UserSystem.system),
        )
        .order_by(User.full_name, User.email)
    )

    cond = []
    if not include_inactive_users:
        cond.append(User.is_active.is_(True))
    if search:
        q = f"%{search.strip()}%"
        cond.append(or_(User.full_name.ilike(q), User.email.ilike(q)))
    if position_id:
        cond.append(User.position_id == position_id)
    if system_id:
        stmt = stmt.join(UserSystem, UserSystem.user_id == User.id)
        cond.append(UserSystem.system_id == system_id)
    if exam_electrical_passed is not None:
        cond.append(EmployeeProfile.exam_electrical_passed.is_(exam_electrical_passed))
    if pass_has is not None:
        cond.append(EmployeeProfile.pass_has.is_(pass_has))
    if exam_valid_to_from:
        cond.append(EmployeeProfile.exam_electrical_valid_to >= exam_valid_to_from)
    if exam_valid_to_to:
        cond.append(EmployeeProfile.exam_electrical_valid_to <= exam_valid_to_to)
    if pass_valid_to_from:
        cond.append(EmployeeProfile.pass_valid_to >= pass_valid_to_from)
    if pass_valid_to_to:
        cond.append(EmployeeProfile.pass_valid_to <= pass_valid_to_to)

    if expired_only:
        today = date.today()
        cond.append(
            or_(
                and_(EmployeeProfile.exam_electrical_valid_to.is_not(None), EmployeeProfile.exam_electrical_valid_to < today),
                and_(EmployeeProfile.pass_valid_to.is_not(None), EmployeeProfile.pass_valid_to < today),
            )
        )
    elif expiring_in_days is not None and expiring_in_days >= 0:
        today = date.today()
        to_day = today + timedelta(days=expiring_in_days)
        cond.append(
            or_(
                and_(
                    EmployeeProfile.exam_electrical_valid_to.is_not(None),
                    EmployeeProfile.exam_electrical_valid_to >= today,
                    EmployeeProfile.exam_electrical_valid_to <= to_day,
                ),
                and_(
                    EmployeeProfile.pass_valid_to.is_not(None),
                    EmployeeProfile.pass_valid_to >= today,
                    EmployeeProfile.pass_valid_to <= to_day,
                ),
            )
        )

    if cond:
        stmt = stmt.where(*cond)

    users = (await session.execute(stmt)).scalars().unique().all()
    return [_row_to_out(u) for u in users]


@router.patch("/{user_id}", response_model=EmployeeDirectoryRowOut)
async def patch_employee_profile(
    user_id: uuid.UUID,
    body: EmployeeDirectoryPatch,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(EMPLOYEE_DIRECTORY_MANAGE))],
) -> EmployeeDirectoryRowOut:
    user = await session.get(User, user_id)
    if not user:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    profile = (
        await session.execute(select(EmployeeProfile).where(EmployeeProfile.user_id == user_id))
    ).scalar_one_or_none()
    if not profile:
        profile = EmployeeProfile(user_id=user_id)
        session.add(profile)
        await session.flush()

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(profile, k, v)

    await session.flush()
    u = (
        await session.execute(
            select(User)
            .where(User.id == user_id)
            .options(
                selectinload(User.position),
                selectinload(User.employee_profile),
                selectinload(User.system_memberships).selectinload(UserSystem.system),
            )
        )
    ).scalar_one()
    return _row_to_out(u)
