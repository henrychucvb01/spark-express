import test from "node:test";
import assert from "node:assert/strict";
import { parseAdultRoster, rosterSummary } from "../server/roster.js";
test("district export titles and quoted names are parsed without changing IDs", () => {
  const rows = parseAdultRoster(
    'District report,,,\nPOS Number,Name,Grade,HR\n000123,"LEE, JORDAN",E,ADULT\n000124,"LEE, JORDAN",E,ADULT\n',
  );
  assert.equal(rows[0].employeeNumber, "000123");
  assert.equal(rows[0].name, "LEE, JORDAN");
  assert.deepEqual(rosterSummary(rows), {
    employees: 2,
    duplicateEmployeeNumbers: 0,
    duplicateNameGroups: 1,
  });
});
test("invalid or duplicate employee numbers reject the entire roster", () => {
  assert.throws(
    () => parseAdultRoster("POS Number,Name\n123,One\n123,Two"),
    /duplicate/,
  );
  assert.throws(
    () => parseAdultRoster("POS Number,Name\n1.2E6,One"),
    /invalid/,
  );
  assert.throws(
    () => parseAdultRoster("Student Number,Name\n123,One"),
    /Required/,
  );
});
