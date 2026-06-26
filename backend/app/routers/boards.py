import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.deps import get_current_user
from app.models import Board, BoardMember, KanbanColumn, System, Task, User, UserSystem
from app.models.board import (
    BOARD_MEMBER_ROLE_EDITOR,
    BOARD_MEMBER_ROLE_MANAGER,
    BOARD_SCOPE_GLOBAL,
    BOARD_SCOPE_SYSTEM,
)
from app.permissions import BOARD_COLUMNS_MANAGE
from app.schemas.board import (
    BoardCreate,
    BoardDeletePreviewOut,
    BoardMemberOut,
    BoardMembersReplace,
    BoardOut,
    BoardUpdate,
    KanbanColumnCreate,
    KanbanColumnOut,
    KanbanColumnUpdate,
)
from app.schemas.audit import AuditEventOut
from app.services.authz import user_has_permission
from app.services.audit import list_audit_events_for_entity, record_audit_event

router = APIRouter(prefix="/boards", tags=["boards"])


async def _clear_done_columns_except(
    session: AsyncSession, board_id: uuid.UUID, keep_column_id: uuid.UUID
) -> None:
    await session.execute(
        update(KanbanColumn)
        .where(KanbanColumn.board_id == board_id, KanbanColumn.id != keep_column_id)
        .values(is_done_column=False)
    )


def _board_to_out(board: Board, system_name: str | None = None) -> BoardOut:
    cols = sorted(board.columns, key=lambda c: (c.sort_order, c.name))
    return BoardOut(
        id=board.id,
        name=board.name,
        slug=board.slug,
        scope=board.scope,
        system_id=board.system_id,
        system_name=system_name,
        is_default=board.is_default,
        is_archived=board.is_archived,
        created_at=board.created_at,
        columns=[KanbanColumnOut.model_validate(c) for c in cols],
    )


async def _board_visible_for_user(session: AsyncSession, user: User, board: Board) -> bool:
    if user.is_superuser or await user_has_permission(session, user, BOARD_COLUMNS_MANAGE):
        return True
    if board.is_archived:
        return False
    if board.scope == BOARD_SCOPE_GLOBAL:
        return True
    member_ids = {m.user_id for m in (board.members or [])}
    if user.id in member_ids:
        return True
    if board.scope == BOARD_SCOPE_SYSTEM and board.system_id is not None:
        in_system = await session.scalar(
            select(UserSystem.user_id)
            .where(UserSystem.user_id == user.id, UserSystem.system_id == board.system_id)
            .limit(1)
        )
        return in_system is not None
    return False


async def _board_member_role(session: AsyncSession, board_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    role = await session.scalar(
        select(BoardMember.role).where(BoardMember.board_id == board_id, BoardMember.user_id == user_id).limit(1)
    )
    return str(role) if role is not None else None


async def _can_manage_board_columns(session: AsyncSession, user: User, board: Board) -> bool:
    if user.is_superuser or await user_has_permission(session, user, BOARD_COLUMNS_MANAGE):
        return True
    if board.scope != BOARD_SCOPE_SYSTEM:
        return False
    role = await _board_member_role(session, board.id, user.id)
    return role in {BOARD_MEMBER_ROLE_EDITOR, BOARD_MEMBER_ROLE_MANAGER}


async def _can_delete_board(session: AsyncSession, user: User, board: Board) -> bool:
    if user.is_superuser or await user_has_permission(session, user, BOARD_COLUMNS_MANAGE):
        return True
    if board.scope != BOARD_SCOPE_SYSTEM:
        return False
    role = await _board_member_role(session, board.id, user.id)
    return role == BOARD_MEMBER_ROLE_MANAGER


async def _can_manage_board_settings(session: AsyncSession, user: User, board: Board) -> bool:
    return await _can_delete_board(session, user, board)


@router.get("", response_model=list[BoardOut])
async def list_boards(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[BoardOut]:
    boards = (
        await session.execute(select(Board).options(selectinload(Board.columns), selectinload(Board.members)))
    ).scalars().unique().all()
    system_ids = {b.system_id for b in boards if b.system_id is not None}
    system_name_by_id: dict[uuid.UUID, str] = {}
    if system_ids:
        rows = await session.execute(select(System.id, System.name).where(System.id.in_(system_ids)))
        system_name_by_id = {sid: sname for sid, sname in rows.all()}
    out: list[BoardOut] = []
    for b in boards:
        if await _board_visible_for_user(session, user, b):
            out.append(_board_to_out(b, system_name_by_id.get(b.system_id) if b.system_id else None))
    out.sort(key=lambda x: (0 if x.scope == BOARD_SCOPE_GLOBAL else 1, x.name.lower()))
    return out


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
    system_name = None
    if board.system_id is not None:
        system_name = await session.scalar(select(System.name).where(System.id == board.system_id))
    return _board_to_out(board, str(system_name) if system_name else None)


@router.post("", response_model=BoardOut, status_code=status.HTTP_201_CREATED)
async def create_board(
    body: BoardCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    creator: Annotated[User, Depends(get_current_user)],
) -> BoardOut:
    if not creator.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Только администратор может создавать доски")
    if body.system_id is not None:
        sys_row = await session.get(System, body.system_id)
        if not sys_row or not sys_row.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="System not found")
    exists = await session.scalar(select(Board.id).where(Board.slug == body.slug))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Board slug already exists")

    board = Board(
        name=body.name,
        slug=body.slug,
        scope=body.scope,
        system_id=body.system_id,
        is_default=False,
        is_archived=False,
    )
    session.add(board)
    await session.flush()
    session.add(
        BoardMember(
            board_id=board.id,
            user_id=creator.id,
            role=BOARD_MEMBER_ROLE_MANAGER,
        )
    )
    await session.flush()
    await session.refresh(board, attribute_names=["columns", "members"])
    system_name = None
    if board.system_id is not None:
        system_name = await session.scalar(select(System.name).where(System.id == board.system_id))
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board.id,
        action="board.created",
        actor_user_id=creator.id,
        details={"name": board.name, "scope": board.scope, "system_id": str(board.system_id) if board.system_id else None},
    )
    return _board_to_out(board, str(system_name) if system_name else None)


@router.get("/{board_id}/members", response_model=list[BoardMemberOut])
async def list_board_members(
    board_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[BoardMemberOut]:
    board = (
        await session.execute(select(Board).where(Board.id == board_id).options(selectinload(Board.members)))
    ).scalar_one_or_none()
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if not await _board_visible_for_user(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return [BoardMemberOut.model_validate(m) for m in board.members]


@router.put("/{board_id}/members", response_model=list[BoardMemberOut])
async def replace_board_members(
    board_id: uuid.UUID,
    body: BoardMembersReplace,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[BoardMemberOut]:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if not await _can_manage_board_settings(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления доской")

    unique_members = list({m.user_id: m for m in body.members}.values())
    if board.scope == BOARD_SCOPE_SYSTEM and board.system_id is not None:
        for m in unique_members:
            u = await session.get(User, m.user_id)
            if not u or not u.is_active:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый участник доски")
            if u.is_superuser:
                continue
            linked = await session.scalar(
                select(UserSystem.user_id)
                .where(UserSystem.user_id == m.user_id, UserSystem.system_id == board.system_id)
                .limit(1)
            )
            if linked is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Участник доски должен состоять в выбранной системе",
                )
    await session.execute(delete(BoardMember).where(BoardMember.board_id == board_id))
    for m in unique_members:
        u = await session.get(User, m.user_id)
        if not u or not u.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недопустимый участник доски")
        session.add(BoardMember(board_id=board_id, user_id=m.user_id, role=m.role))
    await session.flush()
    rows = (
        await session.execute(select(BoardMember).where(BoardMember.board_id == board_id).order_by(BoardMember.created_at))
    ).scalars().all()
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board_id,
        action="board.members.replaced",
        actor_user_id=user.id,
        details={"member_count": len(rows)},
    )
    return [BoardMemberOut.model_validate(r) for r in rows]


@router.patch("/{board_id}", response_model=BoardOut)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BoardOut:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.scope != BOARD_SCOPE_SYSTEM:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Можно редактировать только системную доску")
    if not await _can_manage_board_settings(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления доской")
    old_name = board.name
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Название доски не может быть пустым")
        board.name = name
    await session.flush()
    system_name = None
    if board.system_id is not None:
        system_name = await session.scalar(select(System.name).where(System.id == board.system_id))
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board.id,
        action="board.updated",
        actor_user_id=user.id,
        details={"name": board.name, "old_name": old_name if body.name is not None else None},
    )
    return _board_to_out(board, str(system_name) if system_name else None)


@router.post("/{board_id}/columns", response_model=KanbanColumnOut, status_code=status.HTTP_201_CREATED)
async def add_column(
    board_id: uuid.UUID,
    body: KanbanColumnCreate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KanbanColumnOut:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if not await _can_manage_board_columns(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления колонками")
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
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board_id,
        action="board.column.created",
        actor_user_id=user.id,
        details={"column_id": str(col.id), "name": col.name},
    )
    return KanbanColumnOut.model_validate(col)


@router.patch("/{board_id}/columns/{column_id}", response_model=KanbanColumnOut)
async def update_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    body: KanbanColumnUpdate,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> KanbanColumnOut:
    col = await session.get(KanbanColumn, column_id)
    if not col or col.board_id != board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if not await _can_manage_board_columns(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления колонками")
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
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board_id,
        action="board.column.updated",
        actor_user_id=user.id,
        details={"column_id": str(col.id), "name": col.name},
    )
    return KanbanColumnOut.model_validate(col)


@router.delete("/{board_id}/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_column(
    board_id: uuid.UUID,
    column_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if not await _can_manage_board_columns(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для управления колонками")
    col = await session.get(KanbanColumn, column_id)
    if not col or col.board_id != board_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Column not found")
    if col.is_system_column:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete system column")
    col_id = col.id
    col_name = col.name
    await session.delete(col)
    await session.flush()
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board_id,
        action="board.column.deleted",
        actor_user_id=user.id,
        details={"column_id": str(col_id), "name": col_name},
    )


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.is_default:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя удалить доску по умолчанию")
    if board.scope != BOARD_SCOPE_SYSTEM:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Можно удалить только системную доску")
    if not await _can_delete_board(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для удаления доски")
    board_name = board.name
    task_count = int(
        (
            await session.execute(
                select(func.count(Task.id)).where(Task.board_id == board.id)
            )
        ).scalar_one()
    )
    if task_count > 0:
        # Явно удаляем задачи доски, чтобы не зависеть от порядка каскадов board/columns/task.
        await session.execute(delete(Task).where(Task.board_id == board.id))
    await record_audit_event(
        session,
        entity_type="board",
        entity_id=board.id,
        action="board.deleted",
        actor_user_id=user.id,
        details={"name": board_name, "tasks_deleted": task_count},
    )
    await session.delete(board)


@router.get("/{board_id}/delete-preview", response_model=BoardDeletePreviewOut)
async def board_delete_preview(
    board_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> BoardDeletePreviewOut:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if board.is_default:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Нельзя удалить доску по умолчанию")
    if board.scope != BOARD_SCOPE_SYSTEM:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Можно удалить только системную доску")
    if not await _can_delete_board(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для удаления доски")

    task_count = int(
        (
            await session.execute(
                select(func.count(Task.id)).where(Task.board_id == board.id)
            )
        ).scalar_one()
    )
    return BoardDeletePreviewOut(board_id=board.id, board_name=board.name, task_count=task_count)


@router.get("/{board_id}/audit", response_model=list[AuditEventOut])
async def list_board_audit(
    board_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> list[AuditEventOut]:
    board = await session.get(Board, board_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")
    if not await _can_manage_board_settings(session, user, board):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для просмотра аудита")
    rows = await list_audit_events_for_entity(session, entity_type="board", entity_id=board_id, limit=200)
    user_ids = {r.actor_user_id for r in rows if r.actor_user_id is not None}
    names_by_id: dict[uuid.UUID, str] = {}
    if user_ids:
        users = await session.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))
        names_by_id = {uid: name for uid, name in users.all()}
    return [
        AuditEventOut(
            id=r.id,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            action=r.action,
            actor_user_id=r.actor_user_id,
            actor_name=names_by_id.get(r.actor_user_id) if r.actor_user_id else None,
            details_json=r.details_json,
            created_at=r.created_at,
        )
        for r in rows
    ]
