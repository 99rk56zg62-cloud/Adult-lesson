import { compareSync, hashSync } from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppError } from "./errors.js";

export function hashPassword(password: string, rounds: number): string {
  return hashSync(password, rounds);
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  return compareSync(password, passwordHash);
}

export function signAccessToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}

export function readAccessToken(token: string, secret: string): string {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw new Error("bad token");
    }
    return payload.sub;
  } catch {
    throw new AppError(401, "UNAUTHORIZED", "Your session has expired. Sign in again.");
  }
}

export function signOAuthState(payload: { sub: string; returnUrl: string }, secret: string): string {
  return jwt.sign({ ...payload, purpose: "google-calendar" }, secret, { expiresIn: "15m" });
}

export function readOAuthState(token: string, secret: string): { sub: string; returnUrl: string } {
  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload === "string" ||
      payload.purpose !== "google-calendar" ||
      typeof payload.sub !== "string" ||
      typeof payload.returnUrl !== "string"
    ) {
      throw new Error("bad state");
    }
    return { sub: payload.sub, returnUrl: payload.returnUrl };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "CALENDAR_AUTH", "That Google sign-in link has expired. Try connecting again.");
  }
}
