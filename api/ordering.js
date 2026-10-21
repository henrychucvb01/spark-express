import { configuration, orderingRpc, rpc } from "../server/database.js";
import { digest, readSession, rateKey } from "../server/security.js";
export function createOrderingHandler({
  env = process.env,
  call = orderingRpc,
  limit = rpc,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
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
      const config = configuration(env);
      if (!config.ready)
        return reply(503, {
          error: "Your school’s ordering service is being prepared.",
        });
      const token = readSession(req.headers.cookie, config.secure);
      if (!token)
        return reply(401, { error: "Sign in again to view your lunch." });
      let body = {};
      if (req.method === "POST") {
        if (req.headers.origin !== config.origin)
          return reply(403, { error: "Reopen SPARK Express and try again." });
        if (
          !String(req.headers["content-type"] ?? "").startsWith(
            "application/json",
          )
        )
          return reply(415, { error: "Use a JSON request." });
        if (Number(req.headers["content-length"]) > 8192)
          return reply(413, { error: "Request is too large." });
        body = req.body;
        if (body === undefined) {
          let text = "";
          for await (const chunk of req) {
            text += chunk;
            if (Buffer.byteLength(text) > 8192)
              return reply(413, { error: "Request is too large." });
          }
          body = JSON.parse(text);
        }
        if (typeof body === "string") body = JSON.parse(body);
        if (
          !body ||
          Array.isArray(body) ||
          typeof body !== "object" ||
          Buffer.byteLength(JSON.stringify(body)) > 8192
        )
          return reply(400, { error: "Invalid order request." });
        const uuid = (value) =>
          typeof value === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            value,
          );
        if (
          !uuid(body.requestId) ||
          !uuid(body.menuId) ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 1 ||
          !body.selections ||
          Array.isArray(body.selections) ||
          typeof body.selections !== "object" ||
          Object.keys(body.selections).length !== 4 ||
          !["entree", "fruit", "vegetable", "milk"].every((k) =>
            uuid(body.selections[k]),
          )
        )
          return reply(400, {
            error: "Choose one item from each meal component.",
          });
        if (
          !(await limit(config, "rate", {
            key: rateKey(config.secret, `order:${digest(token)}`),
            limit: 30,
          }))
        )
          return reply(429, {
            error: "Too many ordering attempts. Wait 15 minutes and try again.",
          });
      }
      // Ignore caller-provided identity, clock, status, price, or school fields.
      const data = {
        tokenHash: digest(token),
        ...(req.method === "POST"
          ? {
              requestId: body.requestId,
              menuId: body.menuId,
              revision: body.revision,
              selections: body.selections,
            }
          : {}),
      };
      const result = await call(
        config,
        req.method === "POST" ? "submit" : "today",
        data,
      );
      if (result.error)
        return reply(result.status || 400, { error: result.error });
      return reply(200, req.method === "POST" ? result.order : result);
    } catch (error) {
      return reply(error instanceof SyntaxError ? 400 : 503, {
        error:
          error instanceof SyntaxError
            ? "Invalid order request."
            : "Your lunch service is temporarily unavailable. Please try again.",
      });
    }
  };
}
export default createOrderingHandler();
