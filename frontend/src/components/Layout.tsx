import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
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
    { to: "/admin/activity", label: "Activity Log" },
    { to: "/profile", label: "My Profile" },
  ],
};

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav dropdown automatically whenever the route changes, so tapping a link
  // doesn't leave the dropdown hanging open over the new page.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  if (!user) return null;
  const items = NAV_BY_ROLE[user.role] ?? [];

  const navContent = (
    <>
      <nav>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-user">
        <div className="who">{user.fullName}</div>
        <div className="role">{ROLE_LABELS[user.role]}</div>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {/* Mobile-only top bar: seal + system name + hamburger toggle. Hidden on desktop widths via
          CSS; the sidebar below is what shows there instead. */}
      <div className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
          <span>SARMS</span>
        </div>
        <button
          className="hamburger"
          aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <aside className={`sidebar ${navOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img className="seal" src="/assets/vau-seal.png" alt="University of Vavuniya seal" />
          <div>
            <div className="name">SARMS</div>
            <div className="sub">Student Academic Results &amp; GPA Management System — University of Vavuniya, Dept. of Physical Science</div>
          </div>
        </div>
        {navContent}
      </aside>
      {navOpen && <div className="sidebar-scrim" onClick={() => setNavOpen(false)} />}

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
