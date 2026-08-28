export type Role =
  | "STUDENT"
  | "LECTURER"
  | "HOD"
  | "DEAN"
  | "CHAIRMAN_EXAM_BRANCH"
  | "EXAMINATION_BRANCH"
  | "SUPER_ADMIN";

export const ALL_ROLES: Role[] = [
  "STUDENT",
  "LECTURER",
  "HOD",
  "DEAN",
  "CHAIRMAN_EXAM_BRANCH",
  "EXAMINATION_BRANCH",
  "SUPER_ADMIN",
];

export type CourseCategory = "CORE" | "ELECTIVE" | "ACU";
export type ComponentType = "THEORY_ONLY" | "PRACTICAL_ONLY" | "BOTH";
export type ICAComponent = "THEORY" | "PRACTICAL";
export type ResultStatus = "ICA_OPEN" | "SUBMITTED" | "HOD_APPROVED" | "RELEASED";
export type CorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  full_name: string;
  email: string;
  personal_email: string | null;
  must_change_password: 0 | 1;
  active: 0 | 1;
  department_id: string | null;
  created_at: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  fullName: string;
  departmentId: string | null;
}

// Express Request augmentation
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
