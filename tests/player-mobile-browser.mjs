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
      const expected = [
        ["Time", "Segment", "Speed (mph)", "Incline"],
        ["Time", "Segment", "Distance", "SPM", "Split /500m"],
        ["Time", "Segment", "Output", "RPM", "Resistance"],
        ["Time", "Segment", "Output", "RPM", "Resistance"],
      ][index];
      const header = [...table.firstElementChild.children].map(cell => cell.textContent);
      if (JSON.stringify(header) !== JSON.stringify(expected)) errors.push(`table ${index} wrong headings`);
      for (const row of table.children) {
        const cells = [...row.children];
        if (cells.length !== expected.length) errors.push(`table ${index} wrong cell count`);
        const boxes = cells.map(textRects);
        for (const [i, cell] of cells.entries()) {
          const box = cell.getBoundingClientRect();
          if (cell.getAttribute("role") === "columnheader" && !cell.textContent.includes(" ") && boxes[i].length !== 1)
            errors.push(`heading wraps: ${cell.textContent}`);
          if (i === 1 && /^Recovery \d+$/.test(cell.textContent) && boxes[i].length !== 1)
            errors.push(`recovery label wraps: ${cell.textContent}`);
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
      const player = table.closest("article");
      const notes = player.querySelectorAll("textarea");
      if (notes.length !== 2 || notes[0].getBoundingClientRect().top <= table.getBoundingClientRect().bottom ||
          notes[1].getBoundingClientRect().top <= notes[0].getBoundingClientRect().bottom ||
          !player.textContent.includes("Exercise Notes") || !player.textContent.includes("Overall Workout Notes")) errors.push("notes misplaced");
      if (table.querySelector("button")) errors.push("cardio table exposes progress controls");
    }
    if (!["59:00–60:30", "5.4–5.6", "0.5–2.5%"].every(value => tables[0].textContent.includes(value)))
      errors.push("run clock or targets lost");
    const speedHeader = tables[0].firstElementChild.children[2];
    const speedHeaderLines = textRects(speedHeader);
    const speeds = [...tables[0].children].slice(1).map(row => row.children[2].textContent);
    if (speedHeaderLines.length !== 2 || speedHeaderLines[1].top <= speedHeaderLines[0].top ||
        !speeds.includes("5.4–5.6") || speeds.some(value => value.includes("mph")))
      errors.push("mph belongs on a second header line only");
    const rowCells = [...tables[1].children].slice(1).map(row => [...row.children].map(cell => cell.textContent));
    if (JSON.stringify(rowCells.slice(0, 2)) !== JSON.stringify([
      ["", "Work 1", "400 m", "20–22", "2:45.5–2:55.5"], ["1:30", "Recovery 1", "", "", ""],
    ])) errors.push("rowing targets or recovery time incorrect");
    if (!["120–160 W", "75–90", "12–18 level"].every(value => tables[2].textContent.includes(value)) ||
        !tables[2].closest("article").textContent.includes("Finalized · read only"))
      errors.push("bike targets or finalized status missing");
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
