from datetime import datetime, timezone
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.http_errors import (
    EMAIL_ALREADY_REGISTERED,
    INVALID_CREDENTIALS,
    SESSION_EXPIRED,
    USER_INACTIVE,
)
from app.database import get_db
from app.deps import get_current_user
from app.models import LoginAudit, Role, User, UserRole
from app.models.refresh_session import (
    REVOKE_ACCOUNT_DISABLED,
    REVOKE_EXPIRED,
    REVOKE_LOGOUT,
    REVOKE_PASSWORD_CHANGED,
    REVOKE_REUSE,
    REVOKE_ROTATED,
)
from app.schemas.auth import LoginAuditOut, LoginJson, ProfileUpdate, RegisterIn, Token
from app.permissions import ALL_PERMISSION_CODES
from app.schemas.user import UserMeOut
from app.config import get_settings
from app.security import (
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_REFRESH,
    create_access_token,
    decode_token_payload,
    hash_password,
    verify_password,
)
from app.services.audit import record_audit_event
from app.services.auth_sessions import (
    get_refresh_session,
    is_concurrent_rotation,
    issue_refresh_session,
    revoke_all_user_sessions,
    revoke_session,
)
from app.services.authz import get_user_by_email, get_user_by_id, get_user_permission_codes
from app.services.request_client import client_ip
from app.services.users_display import user_to_out

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()
_SS = settings.auth_cookie_samesite.lower() if settings.auth_cookie_samesite else "lax"
_SAMESITE = _SS if _SS in {"lax", "strict", "none"} else "lax"


def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(
        key="access_token",
        value=access,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=_SAMESITE,
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=_SAMESITE,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        path="/api/v1/auth",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/v1/auth")


def _expired_session_response() -> JSONResponse:
    """401 вместе со сбросом cookie.

    Именно ответ, а не HTTPException: при исключении FastAPI строит ответ заново и
    заголовки внедрённого Response теряются, то есть cookie остались бы у клиента.
    """
    resp = JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": SESSION_EXPIRED}
    )
    _clear_auth_cookies(resp)
    return resp


async def _start_session(
    session: AsyncSession, response: Response, user: User, request: Request
) -> str:
    """Новая refresh-сессия в БД + обе cookie. Возвращает access-токен для тела ответа."""
    access = create_access_token(str(user.id), user.token_version)
    refresh = await issue_refresh_session(session, user.id, request)
    _set_auth_cookies(response, access, refresh)
    return access


async def _record_login(session: AsyncSession, user_id: uuid.UUID, request: Request) -> None:
    session.add(
        LoginAudit(
            user_id=user_id,
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )
    await session.flush()
    await record_audit_event(
        session,
        entity_type="auth",
        entity_id=user_id,
        action="auth.login",
        actor_user_id=user_id,
        details={
            "ip": client_ip(request),
            "user_agent": request.headers.get("user-agent"),
        },
    )


@router.post("/login", response_model=Token)
async def login_form(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    response: Response,
) -> Token:
    user = await get_user_by_email(session, form.username)
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=USER_INACTIVE)
    await _record_login(session, user.id, request)
    token = await _start_session(session, response, user, request)
    return Token(access_token=token)


@router.post("/login/json", response_model=Token)
async def login_json(
    body: LoginJson,
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    response: Response,
) -> Token:
    user = await get_user_by_email(session, body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=USER_INACTIVE)
    await _record_login(session, user.id, request)
    token = await _start_session(session, response, user, request)
    return Token(access_token=token)


def _read_refresh_cookie(request: Request) -> tuple[uuid.UUID, uuid.UUID] | None:
    """(user_id, jti) из cookie, если refresh-токен корректно подписан."""
    raw = request.cookies.get("refresh_token")
    if not raw:
        return None
    payload = decode_token_payload(raw, expected_type=TOKEN_TYPE_REFRESH)
    if not payload:
        return None
    sub = payload.get("sub")
    jti = payload.get("jti")
    if not isinstance(sub, str) or not isinstance(jti, str):
        return None
    try:
        return uuid.UUID(sub), uuid.UUID(jti)
    except ValueError:
        return None


@router.post("/refresh", response_model=Token)
async def refresh_auth(
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> Token | JSONResponse:
    """Обменивает refresh-cookie на новую пару токенов, отзывая предъявленную сессию."""
    parsed = _read_refresh_cookie(request)
    if not parsed:
        return _expired_session_response()
    uid, jti = parsed

    row = await get_refresh_session(session, jti)
    if row is None or row.user_id != uid:
        return _expired_session_response()

    if row.revoked_at is not None and not is_concurrent_rotation(row):
        # Токен уже был обменян или отозван: признак кражи — гасим все сессии пользователя.
        await revoke_all_user_sessions(session, row.user_id, REVOKE_REUSE)
        await record_audit_event(
            session,
            entity_type="auth",
            entity_id=row.user_id,
            action="auth.session.reuse_detected",
            actor_user_id=row.user_id,
            details={
                "ip": client_ip(request),
                "user_agent": request.headers.get("user-agent"),
                "revoked_reason": row.revoked_reason,
            },
        )
        return _expired_session_response()

    if row.expires_at <= datetime.now(timezone.utc):
        await revoke_session(session, row, REVOKE_EXPIRED)
        return _expired_session_response()

    user = await get_user_by_id(session, uid)
    if not user or not user.is_active:
        await revoke_session(session, row, REVOKE_ACCOUNT_DISABLED)
        return _expired_session_response()

    await revoke_session(session, row, REVOKE_ROTATED)
    token = await _start_session(session, response, user, request)
    return Token(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout_auth(
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    uid: uuid.UUID | None = None
    parsed = _read_refresh_cookie(request)
    if parsed:
        uid, jti = parsed
        row = await get_refresh_session(session, jti)
        if row is not None and row.user_id == uid:
            await revoke_session(session, row, REVOKE_LOGOUT)
    else:
        # refresh-cookie нет (истёк или уже удалён) — автора события берём из access-токена.
        raw_access = request.cookies.get("access_token")
        payload = (
            decode_token_payload(raw_access, expected_type=TOKEN_TYPE_ACCESS)
            if raw_access
            else None
        )
        sub = payload.get("sub") if payload else None
        if isinstance(sub, str):
            try:
                uid = uuid.UUID(sub)
            except ValueError:
                uid = None
    await record_audit_event(
        session,
        entity_type="auth",
        entity_id=uid,
        action="auth.logout",
        actor_user_id=uid,
        details={
            "ip": client_ip(request),
            "user_agent": request.headers.get("user-agent"),
        },
    )
    _clear_auth_cookies(response)


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
    return UserMeOut(
        **base.model_dump(),
        permissions=codes,
        dashboard_preferences=current.dashboard_preferences,
    )


@router.patch("/me", response_model=UserMeOut)
async def patch_me(
    body: ProfileUpdate,
    current: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    response: Response,
) -> UserMeOut:
    data = body.model_dump(exclude_unset=True)
    new_pw_raw = data.pop("new_password", None)
    cur_pw_raw = data.pop("current_password", None)
    password_changed = False
    if new_pw_raw is not None:
        new_pw = str(new_pw_raw).strip()
        if new_pw:
            if len(new_pw) < 8:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Новый пароль: минимум 8 символов",
                )
            if verify_password(new_pw, current.hashed_password):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Новый пароль должен отличаться от текущего",
                )
            # Обязательная смена после сброса/импорта — без текущего пароля (сессия уже есть).
            if not current.must_change_password:
                cur_pw = str(cur_pw_raw or "").strip()
                if not cur_pw or not verify_password(cur_pw, current.hashed_password):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Неверный текущий пароль",
                    )
            current.hashed_password = hash_password(new_pw)
            current.must_change_password = False
            # Старые access-токены и все прочие сессии обесцениваются.
            current.token_version += 1
            password_changed = True

    if "full_name" in data:
        current.full_name = data["full_name"]
    if "birth_date" in data:
        current.birth_date = data["birth_date"]
    if "dashboard_preferences" in data and data["dashboard_preferences"] is not None:
        dp = data["dashboard_preferences"]
        cur = dict(current.dashboard_preferences or {})
        home = dict(cur.get("home") or {})
        if isinstance(dp, dict) and "home" in dp and dp["home"] is not None:
            for k, visible in dp["home"].items():
                if visible:
                    home.pop(k, None)
                else:
                    home[k] = False
        cur["home"] = home
        current.dashboard_preferences = cur
    await session.flush()
    if password_changed:
        # Все устройства выходят из системы, а текущая вкладка получает свежую пару токенов.
        await revoke_all_user_sessions(session, current.id, REVOKE_PASSWORD_CHANGED)
        await record_audit_event(
            session,
            entity_type="auth",
            entity_id=current.id,
            action="auth.password.changed",
            actor_user_id=current.id,
            details={"ip": client_ip(request)},
        )
        await _start_session(session, response, current, request)
    await session.refresh(current, ["position"])
    await session.commit()
    base = user_to_out(current)
    if current.is_superuser:
        codes = list(ALL_PERMISSION_CODES)
    else:
        codes = sorted(await get_user_permission_codes(session, current))
    return UserMeOut(
        **base.model_dump(),
        permissions=codes,
        dashboard_preferences=current.dashboard_preferences,
    )


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
