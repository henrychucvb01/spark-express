import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";

test("the rendered dummy account completes selection, review, status, and matching pickup without sending an order", async (t) => {
  const files = await readdir(new URL("../dist/assets/", import.meta.url));
  const bundle = await readFile(
    new URL(
      "../dist/assets/" + files.find((x) => x.endsWith(".js")),
      import.meta.url,
    ),
    "utf8",
  );
  const errors = [],
    requests = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://express.example/?demo=1",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: console,
  });
  t.after(() => dom.window.close());
  dom.window.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    return {
      ok: true,
      json: async () => ({
        available: false,
        emailAvailable: false,
        account: null,
      }),
    };
  };
  dom.window.crypto.randomUUID = randomUUID;
  dom.window.structuredClone = structuredClone;
  dom.window.eval(bundle);
  const document = dom.window.document;
  const until = async (check) => {
    for (let i = 0; i < 200; i++) {
      if (check()) return;
      await delay(25);
    }
    assert.fail(
      "Expected UI state did not appear: " +
        document.body.textContent.slice(-2000),
    );
  };
  const click = async (text) => {
    const button = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes(text),
    );
    assert.ok(button, "Missing button " + text);
    assert.equal(button.disabled, false);
    button.click();
    await delay(40);
  };
  await until(() => document.querySelector(".demo-login"));
  assert.match(document.body.textContent, /246810/);
  assert.equal(document.querySelector(".brand b").textContent, "CAFÉ LA");
  assert.equal(document.querySelector(".brand").getAttribute("aria-label"), "Cafe LA Express home");
  await click("Sign in to demo");
  await until(() => document.querySelector(".menu-component"));
  const photos = document.querySelectorAll(
    ".entree-choice .menu-photo-frame img",
  );
  assert.equal(photos.length, 2);
  assert.match(document.querySelector(".cafe-summary").textContent, /Choose an option/);
  for (const photo of photos) {
    assert.match(photo.getAttribute("src"), /^\/menu-photos\/[a-z-]+\.webp$/);
    assert.ok(
      (
        await readFile(
          new URL("../public" + photo.getAttribute("src"), import.meta.url),
        )
      ).length > 0,
    );
  }
  assert.equal(document.querySelectorAll(".meal-price b").length, 1);
  photos[0].click();
  await until(() => document.querySelector(".entree-choice.selected"));
  assert.match(
    document.querySelector(".entree-choice.selected .entree-card-footer")
      .textContent,
    /Selected for your lunch/,
  );
  await click("Preview ordering cutoff");
  await until(() =>
    document.body.textContent.includes("Ordering is closed for today."),
  );
  assert.ok(document.querySelector(".menu-component").disabled);
  await click("Reopen demo ordering");
  for (const category of ["entree", "fruit", "vegetable", "milk"]) {
    document.querySelector(`input[name="${category}"]`).click();
    await delay(30);
  }
  assert.match(document.querySelector(".cafe-summary").textContent, /Herb-roasted chicken with rice/);
  assert.equal(document.querySelectorAll(".cafe-summary dd").length, 4);
  await click("Review my lunch");
  assert.match(document.body.textContent, /Herb-roasted chicken with rice/);
  assert.match(document.body.textContent, /\$6\.84/);
  await click("Place demo order");
  await until(() => document.body.textContent.includes("You’re on the list."));
  assert.match(document.body.textContent, /DEMO-\d{8}-001/);
  await click("Demo: kitchen starts preparing");
  await until(() =>
    document.body.textContent.includes("A little kitchen magic."),
  );
  await click("Demo: lunch is ready");
  await until(() => document.body.textContent.includes("Your lunch is ready."));
  await click("Scan my demo lunch");
  await click("Try another teacher");
  await until(() => document.querySelector("[role=alert]"));
  assert.match(
    document.querySelector("[role=alert]").textContent,
    /another faculty member/,
  );
  assert.match(document.body.textContent, /Your lunch is ready/);
  await click("Use my matching ticket");
  await until(() => document.body.textContent.includes("All picked up."));
  assert.match(document.body.textContent, /present your district POS QR/);
  assert.equal(
    requests.some((x) => x.method === "POST"),
    false,
  );
  assert.equal(errors.length, 0, errors.map((x) => x.message).join("\n"));
});
