import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const SESSION_SECONDS = 60 * 60 * 12;
export const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export const newRecoveryCode = () =>
  randomBytes(20)
    .toString("hex")
    .toUpperCase()
    .match(/.{1,5}/g)
    .join("-");
export const normalizeRecovery = (value) =>
  String(value ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
export function validPin(value) {
  return typeof value === "string" && /^\d{6}$/.test(value);
}
export async function hashPin(pin) {
  if (!validPin(pin)) throw new Error("Choose a 6-digit PIN.");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(pin, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function checkPin(pin, stored) {
  if (!validPin(pin)) return false;
  const parts = String(stored ?? "").split(":");
  const valid =
    parts.length === 3 &&
    parts[0] === "scrypt" &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{64}$/.test(parts[2]);
  const salt = valid ? parts[1] : "00000000000000000000000000000000";
  const key = await scrypt(pin, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return valid && timingSafeEqual(key, Buffer.from(parts[2], "hex"));
}
export function rateKey(secret, value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function sessionCookie(token, secure) {
  return `${secure ? "__Host-" : ""}express_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}${secure ? "; Secure" : ""}`;
}
export function readSession(cookie, secure) {
  const name = `${secure ? "__Host-" : ""}express_session`;
  const value = String(cookie ?? "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
