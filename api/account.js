import { randomInt, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { configuration, rpc as databaseRpc } from "../server/database.js";
import {
  checkPin,
  digest,
  hashPin,
  newRecoveryCode,
  newToken,
  normalizeName,
  normalizeRecovery,
  rateKey,
  readSession,
  sessionCookie,
  validPin,
} from "../server/security.js";

const GENERIC =
  "We could not verify those details. Check your information and try again.";
class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const employeeNumber = (value) =>
  typeof value === "string" && /^\d{1,20}$/.test(value.trim())
    ? value.trim()
    : "";
const emailAddress = (value) =>
  typeof value === "string" &&
  value.trim().length <= 254 &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())
    ? value.trim().toLowerCase()
    : "";
async function bodyOf(req) {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json"))
    throw new ClientError("Use a JSON request.", 415);
  if (Number(req.headers["content-length"]) > 8192)
    throw new ClientError("Request is too large.", 413);
  let body = req.body;
  if (body === undefined) {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 8192)
        throw new ClientError("Request is too large.", 413);
    }
    body = JSON.parse(text);
  }
  if (typeof body === "string") body = JSON.parse(body);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Buffer.byteLength(JSON.stringify(body)) > 8192
  )
    throw new ClientError("Invalid request.");
  return body;
}
async function sendEmail(env, to, subject, text) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EXPRESS_EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Email delivery is unavailable.");
}
export function createHandler({
  env = process.env,
  call = databaseRpc,
  deliver = (...args) => sendEmail(env, ...args),
} = {}) {
  return async function handler(req, res) {
    const started = Date.now();
    let config;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json");
    const reply = (status, data) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    try {
      if (!["GET", "POST"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST");
        return reply(405, { error: "Method not allowed." });
      }
      config = configuration(env);
      if (!config.ready) {
        return reply(req.method === "GET" ? 200 : 503, {
          available: false,
          emailAvailable: false,
          account: null,
          error:
            req.method === "POST"
              ? "Account setup is not open yet. Please check back soon."
              : undefined,
        });
      }
      const token = readSession(req.headers.cookie, config.secure);
      const session = () =>
        token
          ? call(config, "session", { tokenHash: digest(token) })
          : Promise.resolve(null);
      if (req.method === "GET") {
        const available = await call(config, "status");
        return reply(200, {
          available,
          emailAvailable: config.email,
          account: available ? await session() : null,
        });
      }
      if (req.headers.origin !== config.origin)
        throw new ClientError(
          "Please reopen SPARK Express and try again.",
          403,
        );
      const body = await bodyOf(req);
      const action = body.action;
      if (
        ![
          "register",
          "login",
          "logout",
          "recover",
          "email_send",
          "email_verify",
          "email_recover",
          "email_reset",
        ].includes(action)
      )
        throw new ClientError("Unknown request.");
      // On Vercel, use the platform-owned client IP, never the caller's forwarded-for.
      const ip = env.VERCEL
        ? req.headers["x-vercel-forwarded-for"]
        : req.socket?.remoteAddress;
      if (!ip) throw new Error("Client address is unavailable.");
      const rate = async (key, limit = 10) => {
        if (
          !(await call(config, "rate", {
            key: rateKey(config.secret, key),
            limit,
          }))
        )
          throw new ClientError(
            "Too many attempts. Wait 15 minutes and try again.",
            429,
          );
      };
      await rate(`ip:${ip}`, 500);
      const id = employeeNumber(body.employeeNumber);
      if (action === "logout") {
        if (token) await call(config, "logout", { tokenHash: digest(token) });
        res.setHeader("Set-Cookie", sessionCookie("", config.secure));
        return reply(200, { ok: true });
      }
      if (action === "register") {
        if (!id || !validPin(body.pin))
          throw new ClientError(
            "Enter your employee number and choose a 6-digit PIN.",
          );
        await rate(`register:${id}`, 5);
        const pinHash = await hashPin(body.pin);
        const roster = await call(config, "roster_lookup", {
          employeeNumber: id,
        });
        const recoveryCode = newRecoveryCode();
        const accountId = roster
          ? await call(config, "register", {
              rosterId: roster.id,
              pinHash,
              recoveryHash: digest(normalizeRecovery(recoveryCode)),
            })
          : null;
        if (!accountId)
          throw new ClientError(
            "Account setup could not be completed. Check your employee number, or sign in if you already registered.",
          );
        const nextToken = newToken();
        if (
          !(await call(config, "session_create", {
            accountId,
            pinHash,
            tokenHash: digest(nextToken),
          }))
        )
          throw new Error("Session could not be created.");
        res.setHeader("Set-Cookie", sessionCookie(nextToken, config.secure));
        return reply(200, {
          account: await call(config, "session", {
            tokenHash: digest(nextToken),
          }),
          recoveryCode,
        });
      }
      if (action === "login") {
        const nameKey = normalizeName(body.name);
        if (!nameKey || nameKey.length > 160 || !validPin(body.pin))
          throw new ClientError(GENERIC, 401);
        if (body.employeeNumber && !id) throw new ClientError(GENERIC, 401);
        await rate(`login:${nameKey}`);
        let candidates = await call(config, "login_lookup", {
          nameKey,
          employeeNumber: id,
        });
        // All matching PINs must resolve to one account. Never return a name list.
        const matches = [];
        // Fixed work for a lookup shape makes missing names/numbers harder to enumerate.
        // More than four name matches require the private employee-number field.
        const slots = id ? 1 : 4;
        if (candidates.length > slots) candidates = [];
        for (let i = 0; i < slots; i++) {
          const candidate = candidates[i];
          if ((await checkPin(body.pin, candidate?.pinHash)) && candidate)
            matches.push(candidate);
        }
        if (matches.length !== 1)
          throw new ClientError(
            `${GENERIC} You can also enter your employee number.`,
            401,
          );
        const nextToken = newToken(),
          account = matches[0];
        if (
          !(await call(config, "session_create", {
            accountId: account.id,
            pinHash: account.pinHash,
            tokenHash: digest(nextToken),
          }))
        )
          throw new ClientError(GENERIC, 401);
        res.setHeader("Set-Cookie", sessionCookie(nextToken, config.secure));
        return reply(200, {
          account: await call(config, "session", {
            tokenHash: digest(nextToken),
          }),
        });
      }
      if (action === "recover") {
        const code = normalizeRecovery(body.recoveryCode);
        if (!id || !/^[A-F0-9]{40}$/.test(code) || !validPin(body.pin))
          throw new ClientError(GENERIC);
        await rate(`recover:${id}`, 5);
        const account = await call(config, "recover_lookup", {
          employeeNumber: id,
        });
        const supplied = Buffer.from(digest(code), "hex");
        const stored = Buffer.from(
          account?.recoveryHash ?? "0".repeat(64),
          "hex",
        );
        if (!timingSafeEqual(supplied, stored) || !account)
          throw new ClientError(GENERIC);
        const recoveryCode = newRecoveryCode();
        const ok = await call(config, "reset_code", {
          accountId: account.id,
          oldRecoveryHash: account.recoveryHash,
          pinHash: await hashPin(body.pin),
          recoveryHash: digest(normalizeRecovery(recoveryCode)),
        });
        if (!ok) throw new ClientError(GENERIC);
        res.setHeader("Set-Cookie", sessionCookie("", config.secure));
        return reply(200, { ok: true, recoveryCode });
      }
      if (!config.email)
        throw new ClientError(
          "Email recovery is not available yet. Use your saved recovery code.",
          503,
        );
      if (action === "email_recover") {
        const email = emailAddress(body.email);
        if (!email) throw new ClientError("Enter a valid email address.");
        await rate(`email-recover:${email}`, 3);
        const account = await call(config, "email_lookup", { email });
        if (account) {
          const resetToken = newToken();
          await call(config, "email_token", {
            accountId: account.id,
            purpose: "reset",
            tokenHash: digest(resetToken),
            email,
          });
          // Tokens stay in URL fragments so browsers do not send them to servers or referrers.
          try {
            await deliver(
              email,
              "Reset your SPARK Express PIN",
              `Reset your PIN within 15 minutes:\n${config.origin}/#reset=${resetToken}\n\nIf you did not request this, ignore this email.`,
            );
          } catch {
            /* Keep account existence private. */
          }
        }
        await delay(
          Math.max(0, 1000 + randomInt(0, 250) - (Date.now() - started)),
        );
        return reply(200, {
          ok: true,
          message:
            "If that address is verified on an account, you will receive a reset link.",
        });
      }
      if (action === "email_reset") {
        if (!/^[a-f0-9]{64}$/.test(body.token ?? "") || !validPin(body.pin))
          throw new ClientError(GENERIC);
        await rate(`email-reset:${digest(body.token)}`, 5);
        const recoveryCode = newRecoveryCode();
        const ok = await call(config, "reset_email", {
          tokenHash: digest(body.token),
          pinHash: await hashPin(body.pin),
          recoveryHash: digest(normalizeRecovery(recoveryCode)),
        });
        if (!ok)
          throw new ClientError(
            "This reset link has expired or has already been used. Request another link.",
          );
        res.setHeader("Set-Cookie", sessionCookie("", config.secure));
        return reply(200, { ok: true, recoveryCode });
      }
      const account = await session();
      if (!account) throw new ClientError("Sign in again to continue.", 401);
      if (action === "email_send") {
        const email = emailAddress(body.email);
        if (!email) throw new ClientError("Enter a valid email address.");
        await rate(`email-send:${account.id}`, 3);
        const code = String(randomInt(0, 1000000)).padStart(6, "0");
        await call(config, "email_token", {
          accountId: account.id,
          purpose: "verify",
          email,
          tokenHash: digest(code),
        });
        await deliver(
          email,
          "Verify your SPARK Express recovery email",
          `Your verification code is ${code}. It expires in 15 minutes.\n\nIf you did not request this, ignore this email.`,
        );
        return reply(200, { ok: true });
      }
      if (action === "email_verify") {
        if (!/^\d{6}$/.test(body.code ?? ""))
          throw new ClientError("Enter the 6-digit email code.");
        await rate(`email-verify:${account.id}`, 5);
        if (
          !(await call(config, "email_verify", {
            accountId: account.id,
            tokenHash: digest(body.code),
          }))
        )
          throw new ClientError(
            "We could not verify that code. Check it or request a new one.",
          );
        return reply(200, { account: await session() });
      }
    } catch (error) {
      if (error instanceof SyntaxError)
        return reply(400, { error: "Invalid request." });
      if (error instanceof ClientError)
        return reply(error.status, { error: error.message });
      // Do not log request bodies, employee numbers, PINs, tokens, or provider errors.
      return reply(503, {
        error:
          "SPARK Express is temporarily unavailable. Please try again shortly.",
      });
    }
  };
}
export default createHandler();
