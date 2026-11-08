// Run from the repository root with CHROMIUM_BIN pointing to a local Chromium
// headless-shell binary. Optional SCREENSHOT_DIR retains synthetic evidence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const binary = process.env.CHROMIUM_BIN;
assert.ok(binary, "CHROMIUM_BIN must point to a local Chromium headless-shell binary");
const work = await mkdtemp(join(tmpdir(), "stunna-layout-"));
let browser;
const deadline = setTimeout(() => {
  browser?.kill();
  console.error("Chromium layout test timed out");
  process.exitCode = 1;
}, 30000);
try {
  await build({
    entryPoints: ["tests/fixtures/player-mobile-browser.tsx"],
    bundle: true, outfile: join(work, "player.js"), loader: { ".module.css": "local-css" },
  });
  const page = join(work, "index.html");
  await writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link href="player.css" rel="stylesheet">
    <style>*{box-sizing:border-box}body{margin:0;font:16px Arial,sans-serif}
    h3,h4,p{margin:0}button,input,select,textarea{font:inherit}fieldset{min-width:0;margin-inline:0}</style>
    <div id="root"></div><script src="player.js"></script></html>`);
  browser = spawn(binary, [
    "--headless", "--no-sandbox", "--no-zygote", "--single-process", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-proxy-server",
    "--disable-background-networking", "--remote-debugging-pipe",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let seq = 0;
  let buffer = "";
  const pending = new Map();
  browser.on("exit", (code) => {
    for (const { reject } of pending.values()) reject(Error(`Chromium exited (${code})`));
    pending.clear();
  });
  browser.on("error", (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });
  browser.stdio[4].setEncoding("utf8").on("data", (data) => {
    buffer += data;
    for (let end; (end = buffer.indexOf("\0")) >= 0;) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  function send(method, params = {}, sessionId) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    });
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

  function inspectLayout() {
    const tables = [...document.querySelectorAll('[role="table"]')];
    if (tables.length !== 4) return null;
    const errors = [];
    let measured = 0;
    function textRects(cell) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const rects = [];
      for (let node; (node = walker.nextNode());) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
      return rects;
    }
    for (const [index, table] of tables.entries()) {
      const expected = index === 3 ? ["Workout", "Time", "Speed/Output"] : ["Done", "Segment", "Clock", "Target"];
      const header = [...table.firstElementChild.children].map(cell => cell.textContent);
      if (JSON.stringify(header) !== JSON.stringify(expected)) errors.push(`table ${index} wrong headings`);
      for (const row of table.children) {
        const cells = [...row.children];
        if (cells.length !== expected.length) errors.push(`table ${index} wrong cell count`);
        const boxes = cells.map(textRects);
        for (const [i, cell] of cells.entries()) {
          const box = cell.getBoundingClientRect();
          for (const rect of boxes[i]) {
            measured++;
            if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)
              errors.push(`text outside cell: ${cell.textContent}`);
            for (const next of boxes[i + 1] ?? []) {
              if (rect.right > next.left + 0.5 && next.right > rect.left + 0.5 &&
                  rect.bottom > next.top + 0.5 && next.bottom > rect.top + 0.5)
                errors.push(`adjacent text overlaps: ${row.textContent}`);
            }
          }
        }
      }
      const notes = table.closest("section").querySelector("textarea");
      if (!notes || notes.getBoundingClientRect().top <= table.getBoundingClientRect().bottom) errors.push("notes misplaced");
      const buttons = [...table.querySelectorAll("button")];
      if ((index < 2 && !buttons.length) || (index >= 2 && buttons.length)) errors.push("wrong toggle availability");
      if (buttons.some(button => { const box = button.getBoundingClientRect(); return box.width < 44 || box.height < 44; }))
        errors.push("small touch target");
    }
    if (!tables[0].textContent.includes("59:00–60:30") || !tables[0].textContent.includes("5.4–5.6 mph"))
      errors.push("run clock or speed lost");
    if (!["400 m", "2:45–2:55 /500m", "20–22 spm"].every(value => tables[1].textContent.includes(value)) ||
        tables[1].textContent.includes("Unknown") || !tables[1].textContent.includes("—"))
      errors.push("rowing targets or untimed clock incorrect");
    const rowSection = tables[1].closest("section");
    if ([...rowSection.querySelectorAll("p")].filter(p => p.textContent.includes("planned time is unavailable")).length !== 1)
      errors.push("missing untimed clock explanation");
    if (!["120–160 W", "75–90 rpm"].every(value => tables[2].textContent.includes(value)) ||
        !tables[2].parentElement.textContent.includes("Finalized · read only"))
      errors.push("bike targets or finalized explanation missing");
    if (document.documentElement.scrollWidth !== innerWidth) errors.push("horizontal overflow");
    return { width: innerWidth, nestedWidth: Math.round(tables[0].getBoundingClientRect().width), measured, errors };
  }
  for (const width of [375, 390]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1700, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send("Page.navigate", { url: pathToFileURL(page).href }, sessionId);
    let evidence;
    for (let retry = 0; retry < 40 && !evidence; retry++) {
      await delay(75);
      const { result } = await send("Runtime.evaluate", { expression: `(${inspectLayout})()`, returnByValue: true }, sessionId);
      evidence = result.value;
    }
    assert.ok(evidence && evidence.measured > 70, "actual text rectangles were not measured");
    assert.equal(evidence.width, width);
    assert.equal(evidence.nestedWidth, width - 74);
    assert.deepEqual(evidence.errors, []);
    if (process.env.SCREENSHOT_DIR) {
      await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
      const { cssContentSize } = await send("Page.getLayoutMetrics", {}, sessionId);
      const { data } = await send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height: cssContentSize.height, scale: 1 },
      }, sessionId);
      await writeFile(join(process.env.SCREENSHOT_DIR, `stunna-cardio-${width}.png`), Buffer.from(data, "base64"));
    }
    console.log(JSON.stringify(evidence));
  }
} finally {
  clearTimeout(deadline);
  browser?.kill();
  await rm(work, { recursive: true, force: true });
}
