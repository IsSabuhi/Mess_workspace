# Портал MES

Корпоративный портал отдела **MES**: задачи по системам, график смен, справочник сотрудников, база знаний, УСПД и админка.

| Документ | Содержание |
|---|---|
| Этот файл | продукт, обзор функций, Docker Compose, бэкапы |
| [frontend/README.md](frontend/README.md) | React: страницы, локальный dev, `VITE_API_BASE` |
| [backend/README.md](backend/README.md) | FastAPI: роутеры, миграции, env, файлы, скрипты |

## Ключевые функции

### 1. Задачи, доски и аналитика

- Канбан: drag-and-drop, приоритеты, сроки, теги, чеклист, оценка часов, вложения, комментарии с `@`. В колонке сверху ближайший срок, в тот же день — выше приоритет.
- Общая доска и отдельные доски производственных систем (участники: `viewer` / `editor` / `manager`).
- Доступ к задачам по системам и членству в доске.
- Настройки системной доски: участники, колонки/теги, блокировка, аудит.
- Аналитика руководителя: KPI, фильтры, отчёты по нагрузке и системам, выгрузка в Excel.

### 2. График смен

- Автозаполнение и пересборка строки по кадровым данным.
- Типы: `5/2`, сменный, `2/2`.
- Ручные правки, цвет строки, импорт и экспорт Excel (в том числе по месяцам).

### 3. Справочник сотрудников

- Вкладки: экзамены и пропуска, кадровый профиль, отпуска, отчётность.
- Профиль: табельный номер, должность, системы, график, пол, удалёнщик/выездной, отпуска.
- Архив уволенных: отметка и дата увольнения; в обычном списке их нет, по фильтру «Уволенные» / «Все» — есть.
- Уволенные не попадают в график и в назначения на задачи; вход в портал этим не блокируется (это отдельный флаг «Активен» в админке).
- Массовое обновление, фильтры, выгрузка в Excel.

### 4. База знаний и документы

- База знаний: пространства, статьи (TipTap), оглавление, поиск, участники пространства.
- Личные заметки с напоминаниями и вложениями.
- Справочник УСПД (заметки по объектам): доступ у суперпользователя и у сотрудников СМЗиС (ЗФ / НТЭК).

### 5. Администрирование, права, уведомления

- Пользователи, роли, гранулярные права (создание/правка/пароль/удаление, импорты, бэкапы, аудит).
- Раздел админки виден при любом админ-праве; изменять данные можно только с нужным правом.
- Настройки: автоархив задач, срок хранения уведомлений, журнал аудита.
- Полный бэкап PostgreSQL из админки (ручной и по расписанию).
- Центр уведомлений, напоминания по срокам документов, «Что нового» из CI/CD.

## Технологический стек

| Слой | Технологии |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, dnd-kit, ECharts, ExcelJS, TipTap |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic Settings |
| БД | PostgreSQL (внешний, не в Compose) |
| Очередь | Redis + arq (уведомления, ежедневный `pg_dump`) |
| Файлы | MinIO (S3), запасной вариант — локальные `uploads/` |
| Бэкапы БД | Docker-том `backup_data` → `/backups` (не MinIO) |
| Инфраструктура | Docker Compose, Nginx |

## Архитектура репозитория

```text
.
├── backend/                 # API и worker — backend/README.md
├── frontend/                # SPA — frontend/README.md
├── docker-compose.yml       # web, api, worker, redis, minio; api-job (profile jobs)
├── .env.template            # env для Compose
└── README.md
```

## Быстрый запуск (Docker Compose)

PostgreSQL **не входит** в Compose — нужна уже развёрнутая внешняя БД.

```bash
cp .env.template .env
# DATABASE_URL, SECRET_KEY, INITIAL_ADMIN_*, MINIO_PUBLIC_BASE_URL
# VITE_API_BASE оставьте пустым (prod-сборка: /mes/api/api/v1, nginx в web)

docker compose up --build -d
```

Нужен **Compose V2**: команда `docker compose` (с пробелом). Пакет `docker-compose` 1.29 на новом Docker Engine падает с `KeyError: 'ContainerConfig'` при recreate контейнера.

Если это уже случилось:

```bash
sudo docker rm -f $(sudo docker ps -aq --filter name=mes_portal)
sudo docker compose up -d
```

Порты из `.env` (значения по умолчанию):

| Сервис | URL |
|---|---|
| Web | `http://localhost:8811/mes/` (`WEB_PORT`) |
| API напрямую | `http://localhost:8822` (`API_PORT`) |
| Swagger (через nginx web) | `http://localhost:8811/api/docs` |
| MinIO API / Console | `:9000` / `:9001` |

Поднимаются: `web`, `api`, `worker`, `redis`, `minio`, `minio-init`. Сервис `api-job` — только с `--profile jobs`.

При старте `api`:

1. `alembic upgrade head` (если `AUTO_MIGRATE_ON_STARTUP=true`);
2. uvicorn;
3. первый суперпользователь, если БД пустая (`INITIAL_ADMIN_*`).

## Сессии и токены

Пара токенов лежит в HttpOnly-cookie: короткий `access_token` и `refresh_token` (путь `/api/v1/auth`).

- Каждый обмен на `/api/v1/auth/refresh` **проворачивает** refresh-токен: старый отзывается, выдаётся новый. Повторное предъявление уже отозванного токена считается кражей — все сессии пользователя гасятся, в журнал аудита пишется `auth.session.reuse_detected`.
- Живые сессии хранятся в таблице `refresh_sessions`, поэтому выход из системы, сброс пароля админом и отключение учётной записи реально прекращают доступ, а не просто удаляют cookie у клиента. Истёкшие строки раз в сутки убирает `worker`.
- Смена пароля и деактивация увеличивают `users.token_version`, из-за чего немедленно перестают работать и уже выданные `access_token` (иначе они жили бы до `ACCESS_TOKEN_EXPIRE_MINUTES`). У пользователя, сменившего пароль, остаётся активной только текущая вкладка.

Важно при обновлении: формат токенов изменился, поэтому после деплоя **все текущие сессии становятся недействительными** — пользователям нужно войти заново (один раз).

`worker` обрабатывает очередь arq: уведомления по расписанию и создание дампов БД (не через HTTP, чтобы не упереться в таймаут nginx).

Приложение живёт под префиксом `/mes/` (`base` в Vite). Nginx в образе `web` проксирует `/api/`, `/uploads/` и `/files/` (MinIO).

### Резервные копии PostgreSQL

Администрирование → настройки → резервные копии.

Полный `pg_dump` (custom, сжатый). В админке: создать сейчас, скачать, удалить; ежедневный автобэкап (время запуска UTC+7) и срок хранения в днях.

Файлы **не** кладутся в MinIO (бакет публичный). Они на диске сервера:

| Где | Путь |
|---|---|
| В контейнерах `api` / `worker` | `/backups` (`BACKUP_DIR`) |
| На хосте | том `backup_data`, обычно `/var/lib/docker/volumes/mess_workspace_backup_data/_data` |
| Имя на диске | `{uuid}.dump` (человекочитаемое имя — только при скачивании) |

```bash
docker compose exec worker ls -lh /backups
```

Картинки БЗ, УСПД, вложения задач и заметок в дамп **не входят** — они в томе `minio_data` (или в `uploads/`). Для полного восстановления с нуля копируйте и их.

### Резервные копии MinIO

Файлы бакета лежат **не** как исходные имена (`фото.jpg`), а в раскладке MinIO. Бэкап — копия **всего** тома, не отдельных объектов.

| Где | Путь |
|---|---|
| В контейнере `minio` | `/data` |
| На хосте | том `minio_data`, обычно `/var/lib/docker/volumes/mess_workspace_minio_data/_data` |
| Содержимое | бакет `mess-workspace/` (`MINIO_BUCKET`) и служебный `.minio.sys/` |

Имя тома зависит от имени проекта Compose (`mess_workspace_minio_data`, `mes_portal_minio_data`, …): `docker volume ls | grep minio`.

Снять снимок (MinIO лучше остановить, чтобы не поймать полузаписанный объект):

```bash
docker compose stop minio
docker run --rm \
  -v mess_workspace_minio_data:/data:ro \
  -v /path/to/backup:/backup \
  alpine tar czf /backup/minio_data.tgz -C /data .
docker compose start minio
```

Восстановление на другом сервере — в пустой том с **тем же** именем, затем `start minio`. Ключи `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` на приёмнике могут быть другими: доступ к API задают они, объекты в `/data` от ключей не зависят. Имя бакета (`MINIO_BUCKET`) должно совпасть, иначе ссылки из Postgres не откроются.

Чтобы выгрузить объекты **с исходными ключами** (или сразу в другой MinIO), удобнее `mc mirror`, а не копирование файлов с диска.

### Восстановление PostgreSQL из дампа

Из UI не делается — затрёт живую базу.

1. Поднимите Postgres с пустой базой. `api` и `worker` не запускайте (или остановите).
2. Положите `.dump` в том (или смонтируйте файл).
3. Восстановите:

```bash
docker compose --profile jobs run --rm api-job scripts/restore_database_backup.py /backups/файл.dump --clean
```

`--clean` нужен, если в базе уже есть таблицы. Затем запустите `api` и `worker`.

Ротация: дампы за N дней (по умолчанию 10). Потолок числа файлов — `BACKUP_KEEP` (по умолчанию 40).

### Внешний PostgreSQL

В `DATABASE_URL` — хост, доступный **из контейнера** `api`:

- Postgres на том же сервере: `host.docker.internal` или IP LAN;
- `localhost` внутри контейнера указывает на сам контейнер, не на хост.

### Одноразовые скрипты

```bash
docker compose exec api python scripts/infer_employee_genders.py --write
docker compose --profile jobs run --rm api-job scripts/infer_employee_genders.py --write
```

### Конфигурация для Docker

Корневой `.env` (из `.env.template`) → `env_file` сервисов `api` и `worker`.
Локальная разработка без Docker: `backend/.env` и `frontend/.env` — в README пакетов.

## Локальная разработка (без Docker)

```bash
# Backend
cd backend && cp .env.example .env
# venv, pip, alembic, uvicorn — backend/README.md

# Frontend
cd frontend && npm ci && npm run dev
# frontend/README.md; Vite: http://127.0.0.1:5173/mes/
```

## Релиз-уведомления из CI/CD

`backend/scripts/publish-release-note.sh` публикует «Что нового» в центр уведомлений после деплоя. Подробности — в [backend/README.md](backend/README.md).
