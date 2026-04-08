import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.http_errors import NOT_AUTHENTICATED, PERMISSION_DENIED, SUPERUSER_REQUIRED
from app.models import User
from app.security import decode_token
from app.services.authz import get_user_by_id, user_has_permission

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_current_user_optional(
    request: Request,
    token: Annotated[str | None, Depends(oauth2_scheme)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
    cookie_token = request.cookies.get("access_token")
    effective_token = token or cookie_token
    if not effective_token:
        return None
    sub = decode_token(effective_token)
    if not sub:
        return None
    try:
        uid = uuid.UUID(sub)
    except ValueError:
        return None
    return await get_user_by_id(session, uid)


async def get_current_user(
    user: Annotated[User | None, Depends(get_current_user_optional)],
) -> User:
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=NOT_AUTHENTICATED)
    return user


async def get_current_superuser(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=SUPERUSER_REQUIRED)
    return user


def require_permission(code: str):
    async def _dep(
        session: Annotated[AsyncSession, Depends(get_db)],
        user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if not await user_has_permission(session, user, code):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PERMISSION_DENIED)
        return user

    return _dep
