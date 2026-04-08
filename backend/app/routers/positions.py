import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_permission
from app.models import Position, User
from app.permissions import POSITIONS_MANAGE
from app.schemas.position import PositionCreate, PositionOut, PositionUpdate

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("", response_model=list[PositionOut])
async def list_positions(
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    active_only: bool = True,
) -> list[PositionOut]:
    stmt = select(Position).order_by(Position.sort_order, Position.name)
    if active_only:
        stmt = stmt.where(Position.is_active.is_(True))
    result = await session.execute(stmt)
    return [PositionOut.model_validate(p) for p in result.scalars().all()]


@router.post("", response_model=PositionOut, status_code=status.HTTP_201_CREATED)
async def create_position(
    body: PositionCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(POSITIONS_MANAGE))],
) -> PositionOut:
    existing = await session.scalar(select(Position.id).where(Position.slug == body.slug))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slug already exists")
    p = Position(
        name=body.name,
        slug=body.slug,
        description=body.description,
        sort_order=body.sort_order,
        is_active=True,
    )
    session.add(p)
    await session.flush()
    return PositionOut.model_validate(p)


@router.patch("/{position_id}", response_model=PositionOut)
async def update_position(
    position_id: uuid.UUID,
    body: PositionUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(POSITIONS_MANAGE))],
) -> PositionOut:
    p = await session.get(Position, position_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")
    if body.name is not None:
        p.name = body.name
    if body.description is not None:
        p.description = body.description
    if body.sort_order is not None:
        p.sort_order = body.sort_order
    if body.is_active is not None:
        p.is_active = body.is_active
    await session.flush()
    return PositionOut.model_validate(p)


@router.delete("/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_position(
    position_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(POSITIONS_MANAGE))],
) -> None:
    p = await session.get(Position, position_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")
    await session.delete(p)
