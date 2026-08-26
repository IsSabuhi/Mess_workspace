# Frontend — Портал MES

SPA на React: задачи, график, справочник, база знаний, УСПД и админка.

Общий обзор продукта и запуск через Docker — в [корневом README](../README.md).

## Стек

| Библиотека | Назначение |
|---|---|
| React 19 + TypeScript | UI |
| Vite 6 | dev-сервер и production-сборка |
| Tailwind CSS | стили |
| TanStack Query | запросы к API, кэш |
| React Router 7 | маршруты (`basename=/mes`) |
| TipTap | редактор статей БЗ |
| dnd-kit | drag-and-drop канбана |
| ECharts | графики аналитики |
| ExcelJS | экспорт графика, справочника, аналитики |
| Lucide + Sonner | иконки и toast |

## Структура

```text
frontend/
├── src/
│   ├── api/           # HTTP-клиенты по доменам
│   ├── components/    # общий UI (модалки, редактор, дерево БЗ, …)
│   ├── context/       # AuthContext
│   ├── lib/           # права, toast, экспорты, утилиты
│   ├── pages/         # страницы маршрутов
│   ├── App.tsx        # роутинг и guards
│   ├── main.tsx       # BrowserRouter basename="/mes"
│   └── index.css
├── deploy/nginx.conf  # nginx в образе: /mes/, /api/, /uploads/, /files/
├── Dockerfile         # multi-stage: npm build → nginx
├── vite.config.ts
└── .env.example
```

## Страницы (`src/pages`)

Пути ниже — относительно `basename=/mes` (в браузере: `/mes/tasks`, `/mes/admin`, …).

| Страница | Маршрут | Назначение |
|---|---|---|
| `HomePage` | `/` | Главная |
| `LoginPage` | `/login` | Вход |
| `TasksPage` | `/tasks` | Канбан, карточка задачи |
| `BoardSettingsPage` | `/tasks/boards/:boardId/settings` | Настройки системной доски |
| `ManagerTeamDashboardPage` | `/team-dashboard` | Аналитика руководителя |
| `SchedulePage` | `/schedule` | График смен |
| `EmployeeDirectoryPage` | `/employee-directory` | Справочник, экзамены, отпуска, архив уволенных |
| `KnowledgePage` | `/knowledge/...` | База знаний |
| `NotesPage` | `/notes` | Личные заметки |
| `NotificationsPage` | `/notifications` | Уведомления |
| `SystemsPage` / `PositionsPage` | `/systems`, `/positions` | Справочники |
| `AdminPage` | `/admin` | Пользователи, роли, настройки, бэкапы, аудит, импорты |
| `UspdPage` | `/uspd` | Справочник УСПД (суперпользователь или СМЗиС ЗФ/НТЭК) |
| `SettingsPage` | `/settings` | Профиль пользователя |
| `UsersRedirectPage` | `/users` | Редирект в админку |

Права: `src/lib/permissions.ts` и guards в `App.tsx`.

## Локальный запуск

Нужен backend на `http://127.0.0.1:8000` (см. [backend/README](../backend/README.md)).

```bash
cd frontend
cp .env.example .env   # при необходимости
npm ci
npm run dev
```

Vite: `http://127.0.0.1:5173/mes/` (`base: '/mes/'` в `vite.config.ts`).

Прокси в dev:

- `/api` → backend `:8000`
- `/uploads` → backend `:8000`

В dev `VITE_API_BASE` обычно **пустой**: запросы идут на тот же origin.

### Скрипты

```bash
npm run dev       # разработка
npm run build     # tsc -b && vite build → dist/
npm run preview   # локальный просмотр dist
```

## Переменные окружения

См. `.env.example`.

| Переменная | Описание |
|---|---|
| `VITE_API_BASE` | Префикс API для браузера. Dev: пусто. Prod за reverse-proxy `/mes/api`: часто `/mes/api`. В Docker передаётся как build-arg. |

Клиент: `` `${VITE_API_BASE}/api/v1/...` `` (`src/api/client.ts`). Auth — HttpOnly cookies (`credentials: "include"`).

## Особенности UI / домена

- **Справочник**: уволенные скрыты, пока в фильтре не выбрано «Уволенные» или «Все».
- **Админка**: любой с админ-правом видит разделы; кнопки изменений без нужного права неактивны.
- **База знаний**: вход в пространство открывает корневую статью; поиск — в сайдбаре.
- **Задачи**: карточка — модалка; исполнители, теги, чеклист, оценка, вложения, `@` в комментариях.
- **График**: импорт/экспорт Excel, автозаполнение по кадровому справочнику.
- Toasts через Sonner; ошибки API — `toastApiError`.

## Docker-образ

`Dockerfile`: `npm ci` → `npm run build` → `dist` в nginx. Каталог `dist` в `.dockerignore`, сборка идёт внутри образа.

Сервис `web` в `docker-compose.yml`:

- порт хоста: `WEB_PORT` (по умолчанию 8811);
- приложение: `http://localhost:8811/mes/`;
- nginx проксирует `/api/`, `/uploads/` на `api` и `/files/` на MinIO.

После изменений фронта нужен rebuild образа (`docker compose build web` / `--build`). Bind-mount исходников нет.

## Соглашения

- Новые API-вызовы — в `src/api/<domain>.ts`, типы рядом.
- Проверки прав — через `permissions.ts`, без разрозненных проверок на страницах.
- Модалки: `useModalLayer`; z-index вложенных окон выше родительских.
