# Frontend — Портал MES

SPA на React: UI задач, графика, справочника, базы знаний и админки.

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
| ExcelJS | экспорт графика / справочника |
| Lucide + Sonner | иконки и toast |

## Структура

```text
frontend/
├── src/
│   ├── api/           # HTTP-клиенты по доменам (tasks, knowledge, schedule, …)
│   ├── components/    # Переиспользуемый UI (модалки, дерево БЗ, редактор, …)
│   ├── context/       # AuthContext
│   ├── lib/           # permissions, toast, slugify, экспорты, утилиты
│   ├── pages/         # Страницы маршрутов
│   ├── App.tsx        # Роутинг и guards
│   ├── main.tsx       # BrowserRouter basename="/mes"
│   └── index.css
├── deploy/nginx.conf  # nginx в Docker-образе: /, /api/, /uploads/
├── Dockerfile         # multi-stage: npm build → nginx
├── vite.config.ts
└── .env.example
```

## Страницы (`src/pages`)

| Страница | Маршрут | Назначение |
|---|---|---|
| `HomePage` | `/` | Главная, быстрые ссылки |
| `LoginPage` / `BootstrapPage` | `/login`, `/bootstrap` | Вход / первый вход |
| `TasksPage` | `/tasks` | Канбан, карточка задачи (модалка) |
| `BoardSettingsPage` | `/boards/:id/settings` | Настройки системной доски |
| `ManagerTeamDashboardPage` | `/manager-dashboard` | Аналитика руководителя |
| `SchedulePage` | `/schedule` | График смен |
| `EmployeeDirectoryPage` | `/employee-directory` | Справочник, экзамены/пропуска |
| `KnowledgePage` | `/knowledge/...` | База знаний |
| `NotificationsPage` | `/notifications` | Уведомления |
| `SystemsPage` / `PositionsPage` | `/systems`, `/positions` | Справочники |
| `AdminPage` | `/admin` | Пользователи, роли, аудит |
| `SettingsPage` | `/settings` | Профиль / настройки пользователя |

Права доступа проверяются в `src/lib/permissions.ts` и guards в `App.tsx`.

## Локальный запуск

Нужен запущенный backend на `http://127.0.0.1:8000` (см. [backend/README](../backend/README.md)).

```bash
cd frontend
cp .env.example .env   # при необходимости
npm ci                 # или npm install
npm run dev
```

Откроется Vite на `http://127.0.0.1:5173/mes/` (`base: '/mes/'` в `vite.config.ts`).

Прокси (dev):

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
| `VITE_API_BASE` | Префикс API для браузера. Dev: пусто. Prod за reverse-proxy `/mes/api`: часто `/mes/api`. В Docker build передаётся как build-arg. |

Клиент собирает URL так: `` `${VITE_API_BASE}/api/v1/...` `` (`src/api/client.ts`). Auth — HttpOnly cookies (`credentials: "include"`).

## Особенности UI / домена

- **База знаний**: вход в пространство открывает первую корневую статью (предпочтительно с дочерними / оглавлением); полнотекстовый поиск — в сайдбаре; участники — сворачиваемый блок / ссылка «Участники пространства».
- **Задачи**: карточка — модалка; поля: исполнители, теги, чеклист, оценка часов, вложения, комментарии с `@`.
- **График**: импорт/экспорт Excel, автозаполнение по кадровым полям справочника.
- Toasts через Sonner; ошибки API — `toastApiError`.

## Docker-образ

`Dockerfile`: `npm ci` → `npm run build` → копирование `dist` в nginx.

В `docker-compose.yml` сервис `web`:

- порт хоста: `WEB_PORT` (по умолчанию 8811);
- nginx проксирует `/api/` и `/uploads/` на сервис `api`.

После изменений фронта нужен rebuild образа (`docker compose build web`), bind-mount исходников нет.

## Соглашения

- Новые API-вызовы — в `src/api/<domain>.ts`, типы рядом.
- Проверки прав — через `permissions.ts`, не дублировать ad-hoc на страницах без нужды.
- Модалки: `useModalLayer` / `Modal`; z-index вложенных окон выше родительских (например теги над карточкой задачи).
