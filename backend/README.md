# Backend — Портал MES

FastAPI: REST API, auth, бизнес-логика, миграции, файлы.

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
| openpyxl, holidays | Excel, календарь РФ |
| arq | фоновые задачи (воркер) |

## Структура

```text
backend/
├── app/
│   ├── main.py            # FastAPI, CORS, /uploads, lifespan
│   ├── config.py          # Settings
│   ├── database.py        # async engine / sessions
│   ├── deps.py            # get_current_user, require_permission
│   ├── permissions.py     # коды прав
│   ├── permission_texts.py # названия и описания прав для админки
│   ├── models/
│   ├── schemas/
│   ├── routers/           # /api/v1/...
│   ├── services/
│   └── paths.py           # uploads: kb, tasks, notes, uspd
├── alembic/
├── scripts/
├── Dockerfile
├── requirements.txt
└── .env.example
```

## API-модули (`app/routers`)

Префикс: `/api/v1`.

| Router | Область |
|---|---|
| `auth` | login / refresh / logout / me (cookies) |
| `users` | пользователи, кандидаты в исполнители |
| `roles` | роли и каталог прав |
| `systems` | производственные системы |
| `positions` | должности |
| `boards` | доски, колонки, участники, lock |
| `tasks` | задачи, комментарии, аналитика, вложения |
| `task_tags` | теги |
| `schedule` | график, autofill, Excel |
| `employee_directory` | справочник, архив уволенных |
| `knowledge` | пространства, статьи, поиск, upload |
| `personal_notes` | личные заметки |
| `uspd` | справочник УСПД |
| `notifications` | центр уведомлений |
| `release_notes` | «Что нового» |
| `audit` | журнал аудита |
| `backups` | дампы PostgreSQL |

Документация: `GET /docs`. Health: `GET /health`.

Статика: `GET /uploads/...` (локальное хранилище).

## Локальный запуск

Нужен PostgreSQL.

```bash
cd backend
cp .env.example .env
# DATABASE_URL, SECRET_KEY, CORS_ORIGINS, INITIAL_ADMIN_*
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

При `AUTO_MIGRATE_ON_STARTUP=true` миграции также идут на старте приложения.

Первый суперпользователь создаётся, если в БД нет пользователей (`INITIAL_ADMIN_*`).

## Переменные окружения

Полный пример: `.env.example`. Для Docker Compose — **корневой** `.env` (`.env.template` в корне репозитория).

| Группа | Переменные |
|---|---|
| БД | `DATABASE_URL` (`postgresql+asyncpg://...`) |
| Auth | `SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`, `AUTH_COOKIE_*` |
| УСПД | `USPD_SECRETS_KEY` (Fernet; если пусто — SHA-256 от `SECRET_KEY`) |
| CORS | `CORS_ORIGINS` (через запятую; для Vite — `http://localhost:5173`) |
| Bootstrap | `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_FULL_NAME` |
| Миграции | `AUTO_MIGRATE_ON_STARTUP` |
| Файлы | `STORAGE_BACKEND=local\|minio`, `MINIO_*` |
| Бэкапы | `BACKUP_DIR`, `BACKUP_KEEP` |

Auth: access/refresh в HttpOnly cookies. Path у refresh-cookie должен совпадать с тем, как браузер ходит на API (за reverse-proxy `/mes/api` это частая точка поломок).

## Миграции

```bash
alembic upgrade head
alembic revision --autogenerate -m "описание"
alembic history
```

Модели — в `app/models/`. Новые таблицы и колонки — только через Alembic.

## Файловое хранилище

`app/services/file_storage.py`:

- `STORAGE_BACKEND=local` — `backend/uploads/` (`kb/`, `tasks/`, `notes/`, `uspd/`);
- `STORAGE_BACKEND=minio` — объекты в bucket, публичный URL через `MINIO_PUBLIC_BASE_URL`.

Картинки БЗ, УСПД, вложения задач и личных заметок в `pg_dump` не входят.

## Права (permissions)

Коды — `app/permissions.py`. Тексты для админки (название, описание, пояснение) — `app/permission_texts.py`.

Проверки: `deps.require_permission` / `require_admin_access`, `services/authz.py`, `services/task_policy.py`, `services/knowledge_access.py`, `services/admin_privileges.py`.

Уволенные сотрудники (`employee_profiles.is_dismissed`) исключаются из графика, назначений и кадровых уведомлений; учётка при этом может оставаться активной.

Любое право из блока админки открывает раздел «Администрирование» на просмотр; мутации требуют своего кода.

## Скрипты

| Скрипт | Назначение |
|---|---|
| `scripts/docker-entrypoint.sh` | миграции + uvicorn в контейнере |
| `scripts/infer_employee_genders.py` | пол по ФИО (`--write`) |
| `scripts/restore_database_backup.py` | восстановить PostgreSQL из `.dump` |
| `scripts/publish-release-note.sh` | «Что нового» в уведомления (CI/CD) |
| `scripts/parser_excel.py` | вспомогательный парсинг Excel |

```bash
docker compose exec api python scripts/infer_employee_genders.py --write
docker compose --profile jobs run --rm api-job scripts/infer_employee_genders.py --write
```

Восстановление БД — в [корневом README](../README.md).

## Docker

Сервис `api` в корневом `docker-compose.yml`:

- порт хоста: `API_PORT` (по умолчанию 8822 → 8000);
- `MINIO_ENDPOINT` внутри сети: `http://minio:9000`;
- `extra_hosts: host.docker.internal` для Postgres на хосте.

## Соглашения

- Роутер тонкий: схема + service / policy.
- Ответы — явные `_to_out` / `model_validate`, с `selectinload`.
- Сообщения об ошибках для UI — на русском, где это текст для пользователя.
- Секреты только в env, не в репозитории.
