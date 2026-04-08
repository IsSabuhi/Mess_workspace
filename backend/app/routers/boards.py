import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import require_permission
from app.models import Board, KanbanColumn, User
from app.permissions import BOARD_COLUMNS_MANAGE
from app.schemas.board import BoardOut, KanbanColumnCreate, KanbanColumnOut, KanbanColumnUpdate

router = APIRouter(prefix="/boards", tags=["boards"])


async def _clear_done_columns_except(
    session: AsyncSession, board_id: uuid.UUID, keep_column_id: uuid.UUID
) -> None:
    await session.execute(
        update(KanbanColumn)
        .where(KanbanColumn.board_id == board_id, KanbanColumn.id != keep_column_id)
        .values(is_done_column=False)
    )


def _board_to_out(board: Board) -> BoardOut:
    cols = sorted(board.columns, key=lambda c: (c.sort_order, c.name))
    return BoardOut(
        id=board.id,
        name=board.name,
        slug=board.slug,
        is_default=board.is_default,
        created_at=board.created_at,
        columns=[KanbanColumnOut.model_validate(c) for c in cols],
    )


@router.get("/default", response_model=BoardOut)
async def get_default_board(
    session: Annotated[AsyncSession, Depends(get_db)],
) -> BoardOut:
    stmt = (
        select(Board)
        .where(Board.is_default.is_(True))
        .options(selectinload(Board.columns))
        .limit(1)
    )
    board = (await session.execute(stmt)).scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default board not configured")
    return _board_to_out(board)


@router.post("/{board_id}/columns", response_model=KanbanColumnOut, status_code=status.HTTP_201_CREATED)
async def add_column(
    board_id: uuid.UUID,
    body: KanbanColumnCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(BOARD_COLUMNS_MANAGE))],
) -> KanbanColumnOut:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    existing = await session.scalar(
        select(KanbanColumn.id).where(KanbanColumn.board_id == board_id, KanbanColumn.slug == body.slug)
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Column slug already exists")
    if body.is_done_column:
        await session.execute(
            update(KanbanColumn).where(KanbanColumn.board_id == board_id).values(is_done_column=False)
        )
    col = KanbanColumn(
        board_id=board_id,
        name=body.name,
        slug=body.slug,
        sort_order=body.sort_order,
        is_system_column=False,
        is_done_column=body.is_done_column,
    )
    session.add(col)
    await session.flush()
    return KanbanColumnOut.model_validate(col)


@router.patch("/{board_id}/columns/{column_id}", response_model=KanbanColumnOut)
async def update_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    body: KanbanColumnUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(BOARD_COLUMNS_MANAGE))],
) -> KanbanColumnOut:
    col = await session.get(KanbanColumn, column_id)
    if not col or col.board_id != board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")
    if body.name is not None:
        col.name = body.name
    if body.sort_order is not None:
        col.sort_order = body.sort_order
    if body.is_done_column is not None:
        if body.is_done_column:
            await _clear_done_columns_except(session, board_id, column_id)
            col.is_done_column = True
        else:
            col.is_done_column = False
    await session.flush()
    return KanbanColumnOut.model_validate(col)


@router.delete("/{board_id}/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(require_permission(BOARD_COLUMNS_MANAGE))],
) -> None:
    col = await session.get(KanbanColumn, column_id)
    if not col or col.board_id != board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")
    if col.is_system_column:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete system column")
    await session.delete(col)
