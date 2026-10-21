import { readFile } from "node:fs/promises";
import { parseAdultRoster, rosterSummary } from "../server/roster.js";
import { configuration, rpc } from "../server/database.js";
const args = process.argv.slice(2),
  apply = args.includes("--apply");
const value = (flag) => args[args.indexOf(flag) + 1];
try {
  if (!args.includes("--file") || !args.includes("--location-code"))
    throw new Error(
      "Usage: npm run roster:check -- --file /private/path/roster.csv --location-code CODE [--apply]",
    );
  const locationCode = value("--location-code");
  if (!/^\d+$/.test(locationCode))
    throw new Error("Use the verified district location code.");
  const text = await readFile(value("--file"), "utf8");
  if (Buffer.byteLength(text) > 3 * 1024 * 1024)
    throw new Error("Choose a CSV smaller than 3 MB.");
  const rows = parseAdultRoster(text);
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      locationCode,
      ...rosterSummary(rows),
    }),
  );
  if (apply) {
    const config = configuration({
      ...process.env,
      EXPRESS_ACCOUNTS_ENABLED: "true",
    });
    const result = await rpc(config, "import", { locationCode, rows });
    console.log(JSON.stringify(result));
    console.log(
      "Import complete. Registration remains controlled separately in express_private.schools.",
    );
  } else console.log("Validation passed. No database changes were made.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
