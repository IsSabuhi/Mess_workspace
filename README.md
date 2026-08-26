# Портал MES

Корпоративный портал отдела **MES** для управления операционной работой: задачи по системам, графики смен, справочник сотрудников, база знаний.

| Документ | Содержание |
|---|---|
| Этот файл | продукт, архитектура репозитория, Docker Compose |
| [frontend/README.md](frontend/README.md) | React-приложение: структура, страницы, локальный dev, `VITE_API_BASE` |
| [backend/README.md](backend/README.md) | FastAPI: API-модули, миграции, env, хранилище файлов, скрипты |

## Что это за продукт

**Портал MES** объединяет в одном интерфейсе:

- Kanban-доски (глобальная + системные доски с доступом по участникам),
- график смен с автогенерацией и ручными правками,
- справочник сотрудника (профиль, системы, график, отпуска),
- контроль сроков (экзамены/пропуска),
- аналитику и отчеты по задачам,
- базу знаний,
- ролевую модель доступа и аудит действий.

## Ключевые функции

### 1) Задачи и доски

- Канбан с drag-and-drop, приоритетами, сроками, тегами, чеклистом, оценкой часов, вложениями и комментариями.
- Глобальная доска и системные доски.
- Участники доски с ролями `viewer / editor / manager`.
- Проверка доступа к задачам по системам и членству в доске.
- Настройки системной доски: участники, общие настройки, удаление, аудит.

### 2) Аналитика задач

- KPI (всего, активные, просроченные, high/urgent, без исполнителя).
- Фильтры по системам, колонкам, исполнителям, тегам, срокам и поиску.
- Отчёты по нагрузке, рискам, системам, «создано vs закрыто» и др.
- Экспорт отфильтрованного набора в CSV.

### 3) График смен

- Автогенерация и перегенерация графика.
- Поддержка графиков `5/2`, `Сменный`, `2/2`.
- Ручные правки, цвет строки, импорт/экспорт Excel (в т.ч. по месяцам года).

### 4) Справочник сотрудника и контроль сроков

- Вкладки «Экзамены и пропуска» и «Справочник сотрудника».
- Профиль: дата рождения, должность, системы, пол, график, отпуска.
- Массовое обновление, фильтры, выгрузка в Excel.

### 5) Администрирование и безопасность

- Пользователи, роли, права (permission-модель).
- Глобальные настройки системы (автоархив задач, ротация уведомлений, аудит).
- Журнал аудита.
- Полный бэкап PostgreSQL из админки: ручной и ежедневный по расписанию, скачивание, ротация.

### 6) База знаний и уведомления

- Пространства и статьи (TipTap), оглавление дочерних страниц, полнотекстовый поиск.
- Загрузка файлов/изображений в MinIO или локально.
- Центр уведомлений + release notes из CI/CD.


## Технологический стек

| Слой | Технологии |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, dnd-kit, ECharts, ExcelJS, TipTap |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic Settings |
| БД | PostgreSQL (внешний, не в compose) |
| Очередь | Redis + arq (воркер: уведомления, ежедневный pg_dump) |
| Файлы | MinIO (S3), fallback на локальное хранилище |
| Бэкапы БД | Docker-том `backup_data` → `/backups` (не MinIO) |
| Инфраструктура | Docker Compose, Nginx |

## Архитектура репозитория

```text
.
├── backend/                 # API и worker — см. backend/README.md
├── frontend/                # SPA — см. frontend/README.md
├── docker-compose.yml       # web, api, worker, redis, minio, api-job
├── .env.template            # env для compose
└── README.md
```

## Быстрый запуск (Docker Compose)

PostgreSQL **не входит** в compose — нужна уже развёрнутая внешняя БД.

```bash
cp .env.template .env
# Отредактируйте DATABASE_URL, SECRET_KEY, INITIAL_ADMIN_*, MINIO_PUBLIC_BASE_URL
# При работе за префиксом /mes: VITE_API_BASE=/mes/api

docker compose up --build -d
```

После запуска (порты из `.env`, defaults ниже):

| Сервис | URL |
|---|---|
| Web | `http://localhost:8811` (`WEB_PORT`) |
| API напрямую | `http://localhost:8822` (`API_PORT`) |
| Swagger (через web nginx) | `http://localhost:8811/api/docs` |
| MinIO API / Console | `:9000` / `:9001` |

Что поднимается: `web`, `api`, `worker`, `redis`, `minio`, `minio-init`.

При старте `api`:

1. `alembic upgrade head` (если `AUTO_MIGRATE_ON_STARTUP=true`);
2. `uvicorn`;
3. создание первого суперпользователя при пустой БД (`INITIAL_ADMIN_*`).

`worker` обрабатывает очередь arq: уведомления по расписанию и создание дампов БД (не через HTTP, чтобы не упереться в таймаут nginx).

### Резервные копии PostgreSQL

Управление: **Администрирование → Настройки системы → Резервные копии базы данных**.

Полный `pg_dump` (custom, сжатый). В админке: создать сейчас, скачать, удалить; ежедневный автобэкап с временем запуска (UTC+7) и сроком хранения в днях.

Файлы **не** кладутся в MinIO (бакет публичный). Они на диске сервера:

| Где | Путь |
|---|---|
| В контейнерах `api` / `worker` | `/backups` (`BACKUP_DIR`) |
| На хосте | Docker-том `backup_data`, обычно `/var/lib/docker/volumes/mess_workspace_backup_data/_data` |
| Имя на диске | `{uuid}.dump` (имя вроде `mess_db_….dump` — только при скачивании) |

```bash
docker compose exec worker ls -lh /backups
```

Картинки БЗ и вложения задач/заметок в дамп **не входят** — они в томе `minio_data`. Для полного восстановления с нуля копируйте и его.

Восстановление на новой установке (из UI не делается — затрёт живую базу):

1. Поднимите Postgres с пустой базой. `api` и `worker` не запускайте (или остановите).
2. Положите `.dump` в том (или смонтируйте файл).
3. Восстановите:

```bash
docker compose --profile jobs run --rm api-job scripts/restore_database_backup.py /backups/файл.dump --clean
```

`--clean` нужен, если в базе уже есть таблицы. Затем запустите `api` и `worker`.

Ротация: хранятся дампы за N дней (по умолчанию 10). Место на диске ≈ N × размер одного дампа. Потолок числа файлов — `BACKUP_KEEP` (по умолчанию 40).

### Внешний PostgreSQL

В `DATABASE_URL` — хост, доступный **из контейнера** `api`:

- Postgres на том же сервере: `host.docker.internal` или IP LAN;
- не используйте `localhost` внутри контейнера.

### Одноразовые скрипты

```bash
docker compose exec api python scripts/infer_employee_genders.py --write
docker compose --profile jobs run --rm api-job scripts/infer_employee_genders.py --write
```

### Конфигурация для Docker

Корневой `.env` (из `.env.template`) → `env_file` сервисов `api` и `worker`.
Локальная разработка без Docker: `backend/.env` и `frontend/.env` — детали в README пакетов.

## Локальная разработка (без Docker)

Кратко:

```bash
# Backend
cd backend && cp .env.example .env
# … venv, pip, alembic, uvicorn — см. backend/README.md

# Frontend
cd frontend && npm ci && npm run dev
# см. frontend/README.md; Vite проксирует /api и /uploads на :8000
```

## Релиз-уведомления из CI/CD

Скрипт `backend/scripts/publish-release-note.sh` публикует «Что нового» в центр уведомлений после деплоя. Подробности — в [backend/README.md](backend/README.md).
