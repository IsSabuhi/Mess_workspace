import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./context/AuthContext";
import { canViewManagerTeamDashboard, canViewSchedule } from "./lib/permissions";

const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const BoardSettingsPage = lazy(() => import("./pages/BoardSettingsPage").then((m) => ({ default: m.BoardSettingsPage })));
const EmployeeDirectoryPage = lazy(() =>
  import("./pages/EmployeeDirectoryPage").then((m) => ({ default: m.EmployeeDirectoryPage })),
);
const HomePage = lazy(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })));
const KnowledgePage = lazy(() => import("./pages/KnowledgePage").then((m) => ({ default: m.KnowledgePage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const ManagerTeamDashboardPage = lazy(() =>
  import("./pages/ManagerTeamDashboardPage").then((m) => ({ default: m.ManagerTeamDashboardPage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })),
);
const PositionsPage = lazy(() => import("./pages/PositionsPage").then((m) => ({ default: m.PositionsPage })));
const SchedulePage = lazy(() => import("./pages/SchedulePage").then((m) => ({ default: m.SchedulePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SystemsPage = lazy(() => import("./pages/SystemsPage").then((m) => ({ default: m.SystemsPage })));
const TasksPage = lazy(() => import("./pages/TasksPage").then((m) => ({ default: m.TasksPage })));
const UsersRedirectPage = lazy(() => import("./pages/UsersRedirectPage").then((m) => ({ default: m.UsersRedirectPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">
        Загрузка…
      </div>
    );
  }

  if (state.status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function RequireScheduleAccess({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.status !== "authenticated") {
    return null;
  }
  if (!canViewSchedule(state.user)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function RequireManagerTeamDashboard({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.status !== "authenticated") {
    return null;
  }
  if (!canViewManagerTeamDashboard(state.user)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">
          Загрузка страницы…
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <TasksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks/boards/:boardId/settings"
        element={
          <ProtectedRoute>
            <BoardSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/team-dashboard"
        element={
          <ProtectedRoute>
            <RequireManagerTeamDashboard>
              <ManagerTeamDashboardPage />
            </RequireManagerTeamDashboard>
          </ProtectedRoute>
        }
      />
      <Route
        path="/employee-directory"
        element={
          <ProtectedRoute>
            <EmployeeDirectoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/systems"
        element={
          <ProtectedRoute>
            <SystemsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/positions"
        element={
          <ProtectedRoute>
            <PositionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/knowledge"
        element={
          <ProtectedRoute>
            <KnowledgePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/knowledge/:spaceId"
        element={
          <ProtectedRoute>
            <KnowledgePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/knowledge/:spaceId/:articleId"
        element={
          <ProtectedRoute>
            <KnowledgePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <UsersRedirectPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <NotificationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute>
            <RequireScheduleAccess>
              <SchedulePage />
            </RequireScheduleAccess>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
