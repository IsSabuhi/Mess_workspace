from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.database import async_session_maker
from app.models import Role, User, UserRole
from app.paths import UPLOAD_KB_DIR, UPLOADS_DIR
from app.routers import (
    audit,
    auth,
    boards,
    employee_directory,
    knowledge,
    notifications,
    positions,
    release_notes,
    schedule,
    roles,
    systems,
    task_tags,
    tasks,
    users,
)
from app.security import hash_password

settings = get_settings()

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_KB_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with async_session_maker() as session:
        try:
            users_exist = await session.scalar(select(User.id).limit(1))
            if not users_exist:
                email = settings.initial_admin_email.strip()
                password = settings.initial_admin_password.strip()
                full_name = settings.initial_admin_full_name.strip() or "Администратор"
                if not email or not password:
                    raise RuntimeError(
                        "Empty database: set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in environment."
                    )
                admin = User(
                    email=email,
                    full_name=full_name,
                    hashed_password=hash_password(password),
                    is_superuser=True,
                    is_active=True,
                )
                session.add(admin)
                await session.flush()
                super_admin = (await session.execute(select(Role).where(Role.slug == "super_admin"))).scalar_one_or_none()
                if super_admin:
                    session.add(UserRole(user_id=admin.id, role_id=super_admin.id))
                    await session.flush()
                await session.commit()
        except SQLAlchemyError:
            await session.rollback()
            raise
    yield


app = FastAPI(
    title="Mess Workspace API",
    description=(
        "**Пользователи:** первый администратор создаётся автоматически при пустой БД "
        "(по переменным `INITIAL_ADMIN_*`). "
        "Открытая регистрация: `POST /api/v1/auth/register` (новые пользователи создаются неактивными). "
        "Управление пользователями: `POST /api/v1/users` (нужно право `users.manage`)."
    ),
    lifespan=lifespan,
)

_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins if _origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(roles.router, prefix="/api/v1")
app.include_router(systems.router, prefix="/api/v1")
app.include_router(positions.router, prefix="/api/v1")
app.include_router(boards.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(task_tags.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(release_notes.router, prefix="/api/v1")
app.include_router(schedule.router, prefix="/api/v1")
app.include_router(employee_directory.router, prefix="/api/v1")
app.include_router(knowledge.router, prefix="/api/v1")

app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOADS_DIR)),
    name="uploads",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
