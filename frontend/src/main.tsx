import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./styles.css";

import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { ChangePassword } from "./pages/ChangePassword";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";

import { StudentDashboard } from "./pages/student/StudentDashboard";
import { TargetGpaPlanner } from "./pages/student/TargetGpaPlanner";

import { LecturerDashboard } from "./pages/lecturer/LecturerDashboard";
import { LecturerOffering } from "./pages/lecturer/LecturerOffering";

import { HodDashboard } from "./pages/hod/HodDashboard";
import { HodOfferingDetail } from "./pages/hod/HodOfferingDetail";
import { HodCorrections } from "./pages/hod/HodCorrections";
import { DepartmentReport } from "./pages/shared/DepartmentReport";

import { DeanDashboard } from "./pages/dean/DeanDashboard";
import { DeanBrowse } from "./pages/dean/DeanBrowse";
import { DeanOfferingDetail } from "./pages/dean/DeanOfferingDetail";

import { ChairmanDashboard } from "./pages/chairman/ChairmanDashboard";
import { ChairmanOfferingDetail } from "./pages/chairman/ChairmanOfferingDetail";

import { ExamBoardDashboard } from "./pages/examboard/ExamBoardDashboard";
import { ExamBoardOfferingDetail } from "./pages/examboard/ExamBoardOfferingDetail";

import { AdminOverview } from "./pages/admin/AdminOverview";
import { AdminOrganisation } from "./pages/admin/AdminOrganisation";
import { AdminCourses } from "./pages/admin/AdminCourses";
import { AdminOfferings } from "./pages/admin/AdminOfferings";
import { AdminAccounts } from "./pages/admin/AdminAccounts";
import { AdminActivity } from "./pages/admin/AdminActivity";

import { MarkingSchemeSettings } from "./pages/settings/MarkingSchemeSettings";
import { Profile } from "./pages/shared/Profile";

function HodReportPage() {
  return (
    <div>
      <div className="page-header">
        <h1>Department Report</h1>
        <p>Lifecycle and grade-distribution overview for your department.</p>
      </div>
      <DepartmentReport />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/change-password" element={<ChangePassword />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/profile" element={<Profile />} />

              <Route element={<ProtectedRoute allow={["STUDENT"]} />}>
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/student/target" element={<TargetGpaPlanner />} />
              </Route>

              <Route element={<ProtectedRoute allow={["LECTURER"]} />}>
                <Route path="/lecturer" element={<LecturerDashboard />} />
                <Route path="/lecturer/offerings/:id" element={<LecturerOffering />} />
              </Route>

              <Route element={<ProtectedRoute allow={["HOD"]} />}>
                <Route path="/hod" element={<HodDashboard />} />
                <Route path="/hod/offerings/:id" element={<HodOfferingDetail />} />
                <Route path="/hod/corrections" element={<HodCorrections />} />
                <Route path="/hod/report" element={<HodReportPage />} />
              </Route>

              <Route element={<ProtectedRoute allow={["DEAN"]} />}>
                <Route path="/dean" element={<DeanDashboard />} />
                <Route path="/dean/browse" element={<DeanBrowse />} />
                <Route path="/dean/offerings/:id" element={<DeanOfferingDetail />} />
              </Route>

              <Route element={<ProtectedRoute allow={["CHAIRMAN_EXAM_BRANCH"]} />}>
                <Route path="/chairman" element={<ChairmanDashboard />} />
                <Route path="/chairman/offerings/:id" element={<ChairmanOfferingDetail />} />
              </Route>

              <Route element={<ProtectedRoute allow={["EXAMINATION_BRANCH"]} />}>
                <Route path="/examboard" element={<ExamBoardDashboard />} />
                <Route path="/examboard/offerings/:id" element={<ExamBoardOfferingDetail />} />
              </Route>

              <Route element={<ProtectedRoute allow={["SUPER_ADMIN"]} />}>
                <Route path="/admin" element={<AdminOverview />} />
                <Route path="/admin/organisation" element={<AdminOrganisation />} />
                <Route path="/admin/courses" element={<AdminCourses />} />
                <Route path="/admin/offerings" element={<AdminOfferings />} />
                <Route path="/admin/accounts" element={<AdminAccounts />} />
                <Route path="/admin/activity" element={<AdminActivity />} />
              </Route>

              <Route element={<ProtectedRoute allow={["DEAN", "HOD"]} />}>
                <Route path="/settings" element={<MarkingSchemeSettings />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
