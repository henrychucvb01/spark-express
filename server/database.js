export const PRODUCTION_REF = "kkrcxqhfzepifhkryodd";
export function configuration(env = process.env) {
  const ready = env.EXPRESS_ACCOUNTS_ENABLED === "true";
  if (!ready) return { ready: false, email: false };
  let url, origin;
  try {
    url = new URL(env.SUPABASE_URL);
    origin = new URL(env.EXPRESS_ORIGIN);
  } catch {
    throw new Error("Express server configuration is incomplete.");
  }
  const local = (host) => ["localhost", "127.0.0.1"].includes(host);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && local(url.hostname))
  )
    throw new Error("Use a secure database connection.");
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && local(origin.hostname))
  )
    throw new Error("Use a secure Express origin.");
  if (
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use a database origin without a path.");
  if (
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("Use an Express origin without a path.");
  if (
    url.hostname === `${PRODUCTION_REF}.supabase.co` &&
    !(
      env.VERCEL_ENV === "production" &&
      env.VERCEL_GIT_COMMIT_REF === "main" &&
      env.EXPRESS_ALLOW_PRODUCTION_DATABASE === "true" &&
      origin.origin === "https://express.cafelalistens.org"
    )
  )
    throw new Error(
      "Preview and local builds cannot access the production database.",
    );
  if (
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.EXPRESS_RATE_LIMIT_SECRET ||
    env.EXPRESS_RATE_LIMIT_SECRET.length < 32
  )
    throw new Error("Express server credentials are incomplete.");
  return {
    ready: true,
    url: url.origin,
    key: env.SUPABASE_SERVICE_ROLE_KEY,
    origin: origin.origin,
    secret: env.EXPRESS_RATE_LIMIT_SECRET,
    secure: origin.protocol === "https:",
    email: Boolean(env.RESEND_API_KEY && env.EXPRESS_EMAIL_FROM),
  };
}
export async function rpc(config, action, data = {}) {
  const response = await fetch(`${config.url}/rest/v1/rpc/express_service`, {
    method: "POST",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_action: action, p_data: data }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Express database request failed.");
  return response.json();
}
