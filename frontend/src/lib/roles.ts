import type { Role } from "../api/client";

export const ROLE_LABELS: Record<Role, string> = {
  STUDENT: "Student",
  LECTURER: "Lecturer",
  HOD: "Head of Department",
  DEAN: "Dean",
  CHAIRMAN_EXAM_BRANCH: "Chairman, Examination Branch",
  EXAMINATION_BRANCH: "Examination Branch",
  SUPER_ADMIN: "Super Admin",
};

export const ROLE_HOME: Record<Role, string> = {
  STUDENT: "/student",
  LECTURER: "/lecturer",
  HOD: "/hod",
  DEAN: "/dean",
  CHAIRMAN_EXAM_BRANCH: "/chairman",
  EXAMINATION_BRANCH: "/examboard",
  SUPER_ADMIN: "/admin",
};

export const STATUS_LABELS: Record<string, string> = {
  ICA_OPEN: "ICA in progress",
  SUBMITTED: "Submitted — awaiting HOD review",
  HOD_APPROVED: "HOD approved — awaiting release",
  RELEASED: "Released",
};
