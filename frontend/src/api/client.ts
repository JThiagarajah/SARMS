export type Role =
  | "STUDENT"
  | "LECTURER"
  | "HOD"
  | "DEAN"
  | "CHAIRMAN_EXAM_BRANCH"
  | "EXAMINATION_BRANCH"
  | "SUPER_ADMIN";

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  fullName: string;
  departmentId: string | null;
}

const TOKEN_KEY = "sarms.token";
const USER_KEY = "sarms.user";

// In local dev, requests go to relative "/api/..." and Vite's dev-server proxy forwards them to
// the backend (see vite.config.ts) — no configuration needed. When the frontend is deployed as a
// separate static site from the backend (see README → "Deploying SARMS"), set VITE_API_URL at
// build time (e.g. "https://sarms-backend.onrender.com") so requests reach the right host instead
// of the static site's own origin. Leave it unset to keep today's relative-path behaviour.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearSession();
    if (!location.pathname.startsWith("/login")) location.href = "/login";
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status}).`);
    return (await res.blob()) as unknown as T;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed.");
  return data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T,>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T,>(path: string) => request<T>("DELETE", path),
};

/** Downloads a PDF- or spreadsheet-producing endpoint and triggers a browser save. */
export async function downloadFile(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Download failed." }));
    throw new ApiError(res.status, data.error ?? "Download failed.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Uploads a single file (multipart/form-data) to an endpoint and returns its JSON response.
 *  Used by the bulk-import (Excel/CSV) flows for accounts and marks. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (res.status === 401) {
    clearSession();
    if (!location.pathname.startsWith("/login")) location.href = "/login";
  }
  const data = await res.json().catch(() => ({ error: "Upload failed." }));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Upload failed.");
  return data as T;
}
