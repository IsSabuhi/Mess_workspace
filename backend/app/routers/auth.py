from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.http_errors import (
    EMAIL_ALREADY_REGISTERED,
    INVALID_CREDENTIALS,
    INVALID_POSITION,
    USER_INACTIVE,
)
from app.database import get_db
from app.deps import get_current_user
from app.models import LoginAudit, Position, Role, User, UserRole
from app.schemas.auth import LoginAuditOut, LoginJson, ProfileUpdate, RegisterIn, Token
from app.permissions import ALL_PERMISSION_CODES
from app.schemas.user import UserMeOut
from app.security import create_access_token, hash_password, verify_password
from app.services.authz import get_user_by_email, get_user_permission_codes
from app.services.request_client import client_ip
from app.services.users_display import user_to_out

router = APIRouter(prefix="/auth", tags=["auth"])


async def _record_login(session: AsyncSession, user_id: uuid.UUID, request: Request) -> None:
    session.add(
        LoginAudit(
            user_id=user_id,
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )
    await session.flush()


@router.post("/login", response_model=Token)
async def login_form(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> Token:
    user = await get_user_by_email(session, form.username)
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=USER_INACTIVE)
    await _record_login(session, user.id, request)
    token = create_access_token(str(user.id))
    return Token(access_token=token)


@router.post("/login/json", response_model=Token)
async def login_json(
    body: LoginJson,
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> Token:
    user = await get_user_by_email(session, body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=USER_INACTIVE)
    await _record_login(session, user.id, request)
    token = create_access_token(str(user.id))
    return Token(access_token=token)


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_user(
    body: RegisterIn,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    existing = await session.scalar(select(User.id).where(User.email == body.email))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=EMAIL_ALREADY_REGISTERED)

    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
        is_superuser=False,
        is_active=False,
    )
    session.add(user)
    await session.flush()
    employee = (await session.execute(select(Role).where(Role.slug == "employee"))).scalar_one_or_none()
    if employee:
        session.add(UserRole(user_id=user.id, role_id=employee.id))
        await session.flush()
    return {"id": str(user.id), "email": user.email}


@router.get("/me", response_model=UserMeOut)
async def me(
    current: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> UserMeOut:
    base = user_to_out(current)
    if current.is_superuser:
        codes = list(ALL_PERMISSION_CODES)
    else:
        codes = sorted(await get_user_permission_codes(session, current))
    return UserMeOut(**base.model_dump(), permissions=codes)


@router.patch("/me", response_model=UserMeOut)
async def patch_me(
    body: ProfileUpdate,
    current: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> UserMeOut:
    data = body.model_dump(exclude_unset=True)
    if "full_name" in data:
        current.full_name = data["full_name"]
    if "birth_date" in data:
        current.birth_date = data["birth_date"]
    if "position_id" in data:
        pid = data["position_id"]
        if pid is None:
            current.position_id = None
        else:
            pos = await session.get(Position, pid)
            if not pos:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_POSITION)
            if not pos.is_active and current.position_id != pid:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_POSITION)
            current.position_id = pid
    await session.flush()
    await session.refresh(current, ["position"])
    await session.commit()
    base = user_to_out(current)
    if current.is_superuser:
        codes = list(ALL_PERMISSION_CODES)
    else:
        codes = sorted(await get_user_permission_codes(session, current))
    return UserMeOut(**base.model_dump(), permissions=codes)


@router.get("/me/login-history", response_model=list[LoginAuditOut])
async def login_history(
    current: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> list[LoginAuditOut]:
    stmt = (
        select(LoginAudit)
        .where(LoginAudit.user_id == current.id)
        .order_by(LoginAudit.created_at.desc())
        .limit(50)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [LoginAuditOut.model_validate(r) for r in rows]
