import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AuthUser } from "./types";

const JWT_SECRET = process.env.JWT_SECRET ?? "insecure-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser;
}

/**
 * Generates a random one-time password for bulk-created accounts
 * (Super Admin creates Lecturer/Student logins; forced change on first login).
 */
export function generateOneTimePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** Generates a 6-digit numeric OTP for the forgot-password flow (emailed to the user, hashed at rest). */
export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
