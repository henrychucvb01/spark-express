import Papa from "papaparse";
import { normalizeName } from "./security.js";
export function parseAdultRoster(text) {
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error("CSV could not be read. Check its quoting and delimiters.");
  const header = parsed.data.findIndex(
    (row) =>
      row.some((cell) => String(cell).trim() === "POS Number") &&
      row.some((cell) => String(cell).trim() === "Name"),
  );
  if (header < 0)
    throw new Error("Required POS Number and Name columns were not found.");
  const headings = parsed.data[header].map((cell) => String(cell).trim());
  const numberIndex = headings.indexOf("POS Number"),
    nameIndex = headings.indexOf("Name");
  const seen = new Set(),
    rows = [];
  for (const row of parsed.data.slice(header + 1)) {
    if (row.every((cell) => !String(cell).trim())) continue;
    const employeeNumber = String(row[numberIndex] ?? "").trim();
    const name = String(row[nameIndex] ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!/^\d{1,20}$/.test(employeeNumber) || !name || name.length > 160)
      throw new Error(
        "Roster contains an invalid employee number or name. Nothing was imported.",
      );
    if (seen.has(employeeNumber))
      throw new Error(
        "Roster contains duplicate employee numbers. Nothing was imported.",
      );
    seen.add(employeeNumber);
    rows.push({ employeeNumber, name, nameKey: normalizeName(name) });
  }
  if (!rows.length || rows.length > 5000)
    throw new Error(
      "Choose a roster containing between 1 and 5,000 employees.",
    );
  return rows;
}
export function rosterSummary(rows) {
  const counts = new Map();
  for (const row of rows)
    counts.set(row.nameKey, (counts.get(row.nameKey) ?? 0) + 1);
  return {
    employees: rows.length,
    duplicateEmployeeNumbers: 0,
    duplicateNameGroups: [...counts.values()].filter((n) => n > 1).length,
  };
}
