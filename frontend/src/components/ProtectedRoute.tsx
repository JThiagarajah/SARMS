import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../api/client";

export function ProtectedRoute({ allow }: { allow?: Role[] }) {
  const { user, mustChangePassword } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/login" replace />;
  return <Outlet />;
}
