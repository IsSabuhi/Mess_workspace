import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useAuth } from "./context/AuthContext";
import { AdminPage } from "./pages/AdminPage";
import { EmployeeDirectoryPage } from "./pages/EmployeeDirectoryPage";
import { HomePage } from "./pages/HomePage";
import { PositionsPage } from "./pages/PositionsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SystemsPage } from "./pages/SystemsPage";
import { TasksPage } from "./pages/TasksPage";
import { UsersRedirectPage } from "./pages/UsersRedirectPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { SchedulePage } from "./pages/SchedulePage";

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

export default function App() {
  return (
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
            <SchedulePage />
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
  );
}
