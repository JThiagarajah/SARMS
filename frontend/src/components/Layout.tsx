import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../lib/roles";
import type { Role } from "../api/client";

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  STUDENT: [
    { to: "/student", label: "My Grades & GPA", end: true },
    { to: "/student/target", label: "Target GPA Planner" },
    { to: "/profile", label: "My Profile" },
  ],
  LECTURER: [
    { to: "/lecturer", label: "My Courses", end: true },
    { to: "/profile", label: "My Profile" },
  ],
  HOD: [
    { to: "/hod", label: "Results Review", end: true },
    { to: "/hod/corrections", label: "Correction Requests" },
    { to: "/hod/report", label: "Department Report" },
    { to: "/settings", label: "Marking Scheme Settings" },
    { to: "/profile", label: "My Profile" },
  ],
  DEAN: [
    { to: "/dean", label: "Department Report", end: true },
    { to: "/dean/browse", label: "Browse Results (read-only)" },
    { to: "/settings", label: "Marking Scheme Settings" },
    { to: "/profile", label: "My Profile" },
  ],
  CHAIRMAN_EXAM_BRANCH: [
    { to: "/chairman", label: "Release Queue", end: true },
    { to: "/profile", label: "My Profile" },
  ],
  EXAMINATION_BRANCH: [
    { to: "/examboard", label: "Released Courses", end: true },
    { to: "/profile", label: "My Profile" },
  ],
  SUPER_ADMIN: [
    { to: "/admin", label: "Overview", end: true },
    { to: "/admin/organisation", label: "Departments & Programmes" },
    { to: "/admin/courses", label: "Course Units" },
    { to: "/admin/offerings", label: "Course Offerings" },
    { to: "/admin/accounts", label: "Accounts" },
    { to: "/admin/broadcast", label: "Broadcast Email" },
    { to: "/admin/activity", label: "Activity Log" },
    { to: "/profile", label: "My Profile" },
  ],
};

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;
  const items = NAV_BY_ROLE[user.role] ?? [];

  return (
    <div className="app-shell">
      <header className="topnav">
        <div className="topnav-inner">
          <div className="topnav-brand">
            <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
            <div className="topnav-brand-text">
              <span className="name">SARMS</span>
              <span className="sub">University of Vavuniya · Dept. of Physical Science</span>
            </div>
          </div>

          <nav className="topnav-tabs" aria-label="Primary">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `topnav-tab ${isActive ? "active" : ""}`}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topnav-user">
            <div className="topnav-user-info">
              <span className="who">{user.fullName}</span>
              <span className="role">{ROLE_LABELS[user.role]}</span>
            </div>
            <button
              className="topnav-logout"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="main-column">
        <main className="main">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <strong>SARMS</strong> — Student Academic Results &amp; GPA Management System
          <div className="muted">University of Vavuniya, Department of Physical Science, Faculty of Applied Science</div>
        </div>
        <div className="site-footer-contact">
          <div>Need help? Contact the department office.</div>
          <div>
            <a href="mailto:physci@vau.ac.lk">physci@vau.ac.lk</a> · +94 (0) 24 222 0000
          </div>
        </div>
      </div>
    </footer>
  );
}
