import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth";
import { Role } from "../lib/types";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }
  try {
    const token = header.slice("Bearer ".length);
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}

/** Restricts a route to one or more roles. Every business rule in SARMS is enforced here
 *  server-side, never trusted from the client — this is the single choke point. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `This action requires one of: ${roles.join(", ")}. Your role is ${req.user.role}.`,
      });
    }
    next();
  };
}
