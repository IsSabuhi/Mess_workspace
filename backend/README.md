# Backend — Портал MES

FastAPI-сервис: REST API, auth, бизнес-логика, миграции БД, работа с файлами.

Общий обзор продукта и запуск через Docker — в [корневом README](../README.md).

## Стек

| Технология | Назначение |
|---|---|
| Python 3.12 | runtime |
| FastAPI + Uvicorn | HTTP API |
| SQLAlchemy 2 (async) + asyncpg | ORM / PostgreSQL |
| Alembic | миграции |
| Pydantic Settings | конфигурация из env |
| python-jose + bcrypt | JWT / пароли |
| boto3 | MinIO (S3) |
| openpyxl, holidays | Excel-импорт графика, календарь |

## Структура

```text
backend/
├── app/
│   ├── main.py            # FastAPI app, CORS, static /uploads, lifespan
│   ├── config.py          # Settings
│   ├── database.py        # async engine / sessions
│   ├── deps.py            # get_current_user, require_permission
│   ├── permissions.py     # коды прав
│   ├── models/            # SQLAlchemy
│   ├── schemas/           # Pydantic in/out
│   ├── routers/           # HTTP endpoints (/api/v1/...)
│   ├── services/          # бизнес-логика (authz, schedule, storage, audit, …)
│   └── paths.py           # uploads/kb, uploads/tasks
├── alembic/               # миграции
├── scripts/               # entrypoint, one-off jobs, release notes
├── Dockerfile
├── requirements.txt
└── .env.example
```

## API-модули (`app/routers`)

Префикс приложения: `/api/v1`.

| Router | Область |
|---|---|
| `auth` | login / refresh / logout / register / me (cookies) |
| `users` | пользователи, кандидаты в исполнители |
| `roles` | роли и права |
| `systems` | производственные системы |
| `positions` | должности |
| `boards` | доски, колонки, участники, lock |
| `tasks` | задачи, комментарии, аналитика, вложения |
| `task_tags` | теги задач |
| `schedule` | график смен, autofill, Excel |
| `employee_directory` | справочник сотрудника |
| `knowledge` | пространства, статьи, поиск, upload |
| `notifications` | центр уведомлений |
| `release_notes` | «Что нового» |
| `audit` | журнал аудита |

Документация: `GET /docs` (Swagger), health: `GET /health`.

Статика файлов: `GET /uploads/...` (локальный backend storage).

## Локальный запуск

Нужен PostgreSQL. Скопируйте env:

```bash
cd backend
cp .env.example .env
# поправьте DATABASE_URL, SECRET_KEY, CORS_ORIGINS, INITIAL_ADMIN_*
```

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`

При `AUTO_MIGRATE_ON_STARTUP=true` миграции также выполняются на старте приложения.

Первый суперпользователь создаётся автоматически, если в БД нет пользователей (`INITIAL_ADMIN_*`).

## Переменные окружения

Полный пример: `.env.example`. Для Docker Compose используется **корневой** `.env` (см. `.env.template` в корне репозитория).

| Группа | Переменные |
|---|---|
| БД | `DATABASE_URL` (`postgresql+asyncpg://...`) |
| Auth | `SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `AUTH_COOKIE_*` |
| CORS | `CORS_ORIGINS` (через запятую; для Vite — `http://localhost:5173`) |
| Bootstrap | `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_FULL_NAME` |
| Миграции | `AUTO_MIGRATE_ON_STARTUP` |
| Файлы | `STORAGE_BACKEND=local\|minio`, `MINIO_*` |

Auth: access/refresh в HttpOnly cookies. Refresh cookie path должен совпадать с тем, как браузер ходит на API (за reverse-proxy с префиксом `/mes/api` это частая точка поломок).

## Миграции

```bash
alembic upgrade head
alembic revision --autogenerate -m "описание"
alembic history
```

Модели — в `app/models/`. Новые таблицы/колонки — только через Alembic.

## Файловое хранилище

`app/services/file_storage.py`:

- `STORAGE_BACKEND=local` — файлы в `backend/uploads/` (`kb/`, `tasks/`);
- `STORAGE_BACKEND=minio` — объекты в bucket (`MINIO_BUCKET`), публичный URL через `MINIO_PUBLIC_BASE_URL`.

Используется для изображений БЗ и вложений задач.

## Права (permissions)

Коды заданы в `app/permissions.py` и сидятся миграциями/ролями (например `tasks.read.all`, `schedule.read`, `knowledge.manage.all`, `employee_directory.read`, …).

Проверки: `deps.require_permission`, сервисы `services/authz.py`, `services/task_policy.py`, `services/knowledge_access.py`.

## Скрипты

| Скрипт | Назначение |
|---|---|
| `scripts/docker-entrypoint.sh` | миграции + uvicorn в контейнере |
| `scripts/infer_employee_genders.py` | вывести/записать пол по ФИО (`--write`) |
| `scripts/publish-release-note.sh` | публикация release note в уведомления (CI/CD) |
| `scripts/parser_excel.py` | вспомогательный парсинг Excel |

В Docker:

```bash
docker compose exec api python scripts/infer_employee_genders.py --write
# или
docker compose --profile jobs run --rm api-job scripts/infer_employee_genders.py --write
```

## Docker

Сервис `api` в корневом `docker-compose.yml`:

- порт хоста: `API_PORT` (по умолчанию 8822 → 8000);
- `MINIO_ENDPOINT` внутри сети: `http://minio:9000`;
- `extra_hosts: host.docker.internal` для доступа к Postgres на хосте.

## Соглашения

- Роутер тонкий: валидация схем + вызов service / policy.
- Ответы задач/статей — через явные `_to_out` / `model_validate`, с `selectinload` нужных связей.
- Ошибки для клиента — понятный `detail` на русском, где это UX-сообщение.
- Секреты только в env, не в репозитории.
