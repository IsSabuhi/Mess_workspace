# Mess Workspace

Веб-приложение для учёта задач на общей канбан-доске, с ролями и производственными системами, базой знаний и админ-панелью.

## Возможности

- **Задачи** — канбан по колонкам, drag-and-drop, приоритеты, сроки, исполнитель, привязка к производственной системе.
- **Доступ к задачам** — сотрудники видят задачи только своих систем; руководители с правами «все задачи» — по всей организации.
- **Пользователи и роли** — гибкие права (создание, чтение, редактирование, удаление, доска, база знаний и т.д.), системные и кастомные роли, счётчик пользователей на роль.
- **Производственные системы** — справочник; назначение систем пользователям в админке влияет на видимость задач и список кандидатов в исполнители.
- **База знаний** — пространства, статьи, редактор на TipTap.
- **Профиль** — ФИО, должность, дата рождения; системы отображаются только для просмотра (меняет администратор).
- **Тема** — светлая / тёмная / как в ОС.

## Технологии

| Слой        | Стек |
|------------|------|
| Frontend   | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, dnd-kit, TipTap |
| Backend    | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic |
| БД         | PostgreSQL 17 |
| Хранилище файлов | MinIO (S3-совместимое), локальный fallback |
| Контейнеры | Docker Compose |

## Структура репозитория

```
mess-workspace/
├── backend/          # API (FastAPI), миграции Alembic
├── frontend/         # SPA (Vite + React)
├── docker-compose.yml
└── README.md
```

## Быстрый старт (Docker Compose)

1. Клонируйте репозиторий и перейдите в каталог проекта.

2. При необходимости создайте файл `.env` в корне (см. переменные ниже) или используйте значения по умолчанию из `docker-compose.yml`.

3. Запустите сервисы:

   ```bash
   docker compose up --build
   ```

4. После запуска фронт и API доступны через один адрес:
   - Веб-приложение: **http://localhost:${WEB_PORT}** (по умолчанию `8080`)
   - API docs через прокси: **http://localhost:${WEB_PORT}/api/docs**

5. При первом запуске контейнер API выполнит `alembic upgrade head` и поднимет сервер.

6. Первый суперпользователь создаётся автоматически при пустой БД из переменных
   `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_FULL_NAME`.
   Дополнительно доступна открытая регистрация `POST /api/v1/auth/register` (новый пользователь создаётся с `is_active=false`).

7. В compose поднимаются `web`, `api`, `minio` и `minio-init` (инициализация bucket).
   - Web (nginx + frontend): **http://localhost:${WEB_PORT}**
   - MinIO API: **http://localhost:9000**
   - MinIO Console: **http://localhost:9001**

## Локальная разработка без Docker (API + БД)

1. Подготовьте доступную PostgreSQL (локально, в контейнере или на отдельном сервере).

2. **Backend**

   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate          # Windows
   # source .venv/bin/activate     # Linux / macOS
   pip install -r requirements.txt
   copy .env.example .env          # отредактируйте DATABASE_URL и SECRET_KEY
   alembic upgrade head
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

3. **Frontend (опционально отдельно для dev)**:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

## Переменные окружения

**Backend** (`backend/.env`, пример — `backend/.env.example`):

| Переменная | Описание |
|------------|----------|
| `DATABASE_URL` | Строка подключения async SQLAlchemy, например `postgresql+asyncpg://user:pass@localhost:5432/mess_todo` |
| `SECRET_KEY` | Секрет для JWT (в продакшене — длинная случайная строка) |
| `CORS_ORIGINS` | Разрешённые origin для браузера (через запятую), например `http://localhost:5173` |
| `INITIAL_ADMIN_EMAIL` | Email первого суперпользователя (используется только при пустой БД) |
| `INITIAL_ADMIN_PASSWORD` | Пароль первого суперпользователя (используется только при пустой БД) |
| `INITIAL_ADMIN_FULL_NAME` | ФИО первого суперпользователя |
| `STORAGE_BACKEND` | `minio` или `local` (по умолчанию `minio` в compose) |
| `MINIO_ENDPOINT` | Адрес MinIO для backend, например `http://minio:9000` |
| `MINIO_ACCESS_KEY` | Логин MinIO |
| `MINIO_SECRET_KEY` | Пароль MinIO |
| `MINIO_BUCKET` | Bucket для файлов, например `mess-workspace` |
| `MINIO_PUBLIC_BASE_URL` | Публичная база URL файлов, например `http://<SERVER_IP>:9000` |
| `WEB_PORT` | Порт веб-контейнера на хосте, по умолчанию `8080` |
| `VITE_API_BASE` | База API при сборке frontend-контейнера. Для прокси nginx оставить пустым |

### Файлы и MinIO

- Для загрузки изображений БЗ используется S3-совместимое хранилище.
- В режиме `STORAGE_BACKEND=minio` файлы пишутся в MinIO bucket `${MINIO_BUCKET}`.
- В режиме `STORAGE_BACKEND=local` используется локальная папка `backend/uploads/kb` (fallback).

**Frontend** (`frontend/.env`, пример — `frontend/.env.example`):

| Переменная | Описание |
|------------|----------|
| `VITE_API_BASE` | В dev обычно пусто (прокси Vite). В продакшене — URL API, например `https://api.example.com` |

## Сборка фронтенда для продакшена

```bash
cd frontend
npm install
npm run build
```

Статика окажется в `frontend/dist`. Настройте раздачу через nginx/CDN и проксирование `/api` на бэкенд, либо задайте `VITE_API_BASE` перед сборкой.

