import { Navigate } from "react-router-dom";

export function UsersRedirectPage() {
  return <Navigate to="/admin?tab=users" replace />;
}
