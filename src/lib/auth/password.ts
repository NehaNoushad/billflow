import bcrypt from "bcryptjs";
import crypto from "node:crypto";

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function generateToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
