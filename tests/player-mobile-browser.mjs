// Run from the repository root with CHROMIUM_BIN pointing to a local Chromium
// headless-shell binary. Optional SCREENSHOT_DIR retains synthetic evidence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const binary = process.env.CHROMIUM_BIN;
assert.ok(binary, "CHROMIUM_BIN must point to a local Chromium headless-shell binary");
const work = await mkdtemp(join(tmpdir(), "stunna-layout-"));
// Give the fixture a normal browser origin for relative training API reads.
const server = createServer(async (request, response) => {
  const assets = { "/": ["index.html", "text/html"], "/player.js": ["player.js", "text/javascript"], "/player.css": ["player.css", "text/css"] };
  const asset = assets[new URL(request.url,"http://localhost").pathname];
  if (!asset) return response.writeHead(404).end();
  try {
    const content = await readFile(join(work, asset[0]));
    response.writeHead(200, { "content-type": asset[1] }).end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
let closeBrowser;
const deadline = setTimeout(() => {
  browser?.kill();
  console.error("Chromium layout test timed out");
  process.exitCode = 1;
}, 90000);
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
    "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server",
    "--disable-background-networking", "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", `--user-data-dir=${join(work, "profile")}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  // Use the same isolated profile and loopback CDP transport on Windows and Linux.
  // Current Chrome requires a non-default profile for remote debugging.
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    browser.stderr.setEncoding("utf8").on("data", data => {
      output += data;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    browser.once("error", reject);
    browser.once("exit", code => reject(Error(`Chromium exited before CDP startup (${code})`)));
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
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
  const receive = (data) => {
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
  };
  socket.addEventListener("message", event => receive(event.data + "\0"));
  const disconnected = () => {
    for (const { reject } of pending.values()) reject(Error("Chromium DevTools connection closed"));
    pending.clear();
  };
  socket.addEventListener("error", disconnected);
  socket.addEventListener("close", disconnected);
  function send(method, params = {}, sessionId) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const message = JSON.stringify({ id, method, params, sessionId });
      socket.send(message);
    });
  }
  closeBrowser = async () => {
    await send("Browser.close").catch(() => {});
    socket.close();
  };
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
    if (!["59:00–01:00:30", "5.4–5.6", "0.5–2.5%"].every(value => tables[0].textContent.includes(value)))
      errors.push("run clock or targets lost");
    const speedHeader = tables[0].firstElementChild.children[2];
    const speedHeaderLines = textRects(speedHeader);
    const speeds = [...tables[0].children].slice(1).map(row => row.children[2].textContent);
    if (speedHeaderLines.length !== 2 || speedHeaderLines[1].top <= speedHeaderLines[0].top ||
        !speeds.includes("5.4–5.6") || speeds.some(value => value.includes("mph")))
      errors.push("mph belongs on a second header line only");
    const rowCells = [...tables[1].children].slice(1).map(row => [...row.children].map(cell => cell.textContent));
    if (JSON.stringify(rowCells.slice(0, 2)) !== JSON.stringify([
      ["", "Work 1", "400 m", "20–22", "02:45.5–02:55.5"], ["01:30", "Recovery 1", "", "", ""],
    ])) errors.push("rowing targets or recovery time incorrect");
    if (!["120–160 W", "75–90", "12–18 level"].every(value => tables[2].textContent.includes(value)) ||
        !tables[2].closest("article").textContent.includes("Finalized · read only"))
      errors.push("bike targets or finalized status missing");
    if (!tables[2].closest("article").querySelector('[aria-label="Device source results"]'))
      errors.push("completed cardio device-evidence panel missing");
    if (!document.querySelector('[data-completion-probe="strength"] button'))
      errors.push("strength completion player missing");
    const strength = document.querySelector('[data-completion-probe="strength"]');
    const warmups = strength.querySelector('[aria-label="Prescribed warm-ups"]');
    const sets = strength.querySelector('[aria-label="Strength sets"]');
    if (!warmups || !sets) return { width: innerWidth, measured, errors: [...errors, "strength warm-ups missing"] };
    const warmBox = warmups.getBoundingClientRect(), setBox = sets.getBoundingClientRect();
    if (Math.abs(warmBox.width - setBox.width) > 1 || warmBox.bottom > setBox.top)
      errors.push("warm-ups are not full-width above sets");
    if (warmups.querySelector('button,input,[role="row"]') || warmups.closest('[aria-label="Strength sets"]'))
      errors.push("warm-ups contain set controls or rows");
    if (warmups.querySelectorAll("li").length !== 2 || !warmups.textContent.includes("03:00") ||
        !warmups.textContent.includes("1 sets · 8 reps · 5 lb")) errors.push("warm-up order, duration or strength dose lost");
    if (sets.querySelectorAll('button[aria-label^="Log Set"]').length !== 2 ||
        [...sets.querySelectorAll("button")].filter(button => button.textContent === "Edit").length !== 2)
      errors.push("working set actions changed");
    for (const paragraph of warmups.querySelectorAll("p")) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        for (const word of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
          const rects = [...range.getClientRects()];
          measured += rects.length;
          if (rects.length !== 1) errors.push(`warm-up word broken: ${word[0]}`);
          if (rects.some(rect => rect.left < warmBox.left || rect.right > warmBox.right)) errors.push("warm-up text overflow");
        }
      }
    }
    if (document.documentElement.scrollWidth !== innerWidth) errors.push("horizontal overflow");
    return { width: innerWidth, nestedWidth: Math.round(tables[0].getBoundingClientRect().width),
      warmupWidth: Math.round(warmBox.width), measured, errors };
  }
  async function inspectCompletionFlow() {
    const errors = [];
    const article = document.querySelector('[data-completion-probe="strength"]');
    if (!article) return { errors: ["completion article missing"] };
    const click = (label) => {
      const button = [...article.querySelectorAll("button")].find(item => item.textContent.trim() === label);
      if (!button || button.disabled) { errors.push(`button unavailable: ${label}`); return false; }
      button.click();
      return true;
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 80));
    if (!click("Complete Workout")) return { errors };
    await settle();
    if (!article.textContent.includes("Recorded strength sets: 0 of 2") ||
        !article.textContent.includes("Unrecorded: 2") ||
        !article.textContent.includes("Synthetic saved overall notes"))
      errors.push("confirmation missing strength counts or saved notes");
    if (!click("Confirm Complete Workout")) return { errors };
    await settle();
    if (!article.textContent.includes("Completion unconfirmed") ||
        !article.textContent.includes("Retry completion / verify"))
      errors.push("ambiguous response lacks retry/verification");
    if (!click("Retry completion / verify")) return { errors };
    await settle();
    if (!article.textContent.includes("Completed — workout saved") ||
        article.querySelector('[aria-label="Device source results"]') ||
        article.querySelector("button")?.textContent === "Complete Workout")
      errors.push("completed strength status is not truthful");
    const fields = [...article.querySelectorAll("fieldset")];
    if (!fields.length || fields.some(field => !field.disabled))
      errors.push("completed strength inputs are not read-only");
    const probe = globalThis.__issue34CompletionProbe;
    if (probe.attempts !== 2 || probe.keys.length !== 2 || probe.keys[0] !== probe.keys[1])
      errors.push("ambiguous retry changed idempotency identity");
    if (document.documentElement.scrollWidth !== innerWidth)
      errors.push("completion panel causes horizontal overflow");
    return { errors, attempts: probe.attempts, idempotent: probe.keys[0] === probe.keys[1] };
  }
  for (const width of [402, 390, 375]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1700, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
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
    const { result: completionResult } = await send("Runtime.evaluate", {
      expression: `(${inspectCompletionFlow})()`, awaitPromise: true, returnByValue: true,
    }, sessionId);
    const completion = completionResult.value;
    assert.ok(completion, "completion UI was not exercised");
    assert.deepEqual(completion.errors, []);
    assert.equal(completion.attempts, 2);
    assert.equal(completion.idempotent, true);
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
  async function evaluate(expression) {
    const {result,exceptionDetails}=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},sessionId);
    if(exceptionDetails) throw Error(exceptionDetails.exception?.description??exceptionDetails.text);
    return result.value;
  }
  async function until(expression) {
    for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40)}
    throw Error("Timed out waiting for "+expression);
  }
  const click=async(label)=>{const expression="Array.from(document.querySelectorAll('button')).find(b=>b.checkVisibility() && !b.disabled && b.textContent.trim()==="+JSON.stringify(label)+")";await until("!!("+expression+")");await evaluate("("+expression+").click()")};
  async function edit(selector,value) {
    await evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  }
  for(const width of [402,390,375]) {
    const url="http://127.0.0.1:"+server.address().port+"/?flow="+width;
    await send("Emulation.setDeviceMetricsOverride",{width,height:820,deviceScaleFactor:1,mobile:true},sessionId);
    await send("Page.navigate",{url},sessionId);
    await click("Start Workout");
    const headers="document.querySelectorAll('button[aria-controls]')";
    await until(headers+".length===3");
    const row=index=>evaluate(headers+"["+index+"].click()");
    const open=(index,value)=>until(headers+"["+index+"].getAttribute('aria-expanded')==='"+value+"'");
    async function capture(mode) {
      assert.ok(await evaluate("document.documentElement.scrollWidth===innerWidth"));
      const columns=await evaluate("Array.from("+headers+",row=>Array.from(row.children,c=>Math.round(c.getBoundingClientRect().left)))");
      assert.deepEqual(columns[0],columns[1]); assert.deepEqual(columns[1],columns[2]);
      assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).filter(b=>b.checkVisibility()).every(b=>b.offsetHeight>=44 && b.offsetWidth>=44)"));
      if(process.env.SCREENSHOT_DIR){
        await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});
        const {data}=await send("Page.captureScreenshot",{format:"png"},sessionId);
        await writeFile(join(process.env.SCREENSHOT_DIR,"accordion-"+mode+"-"+width+".png"),Buffer.from(data,"base64"))
      }
    }
    await row(0);await open(0,false);await capture("collapsed");
    await row(0);await row(1);await open(1,true);await capture("expanded");
    await edit("#field-strength-occurrence textarea","Synthetic exercise note");
    await row(0);await open(0,false);
    await send("Page.navigate",{url},sessionId);await click("Resume Workout");
    await until("document.querySelector('#field-strength-occurrence textarea')?.value==='Synthetic exercise note'");
    await click("Edit");
    await edit("fieldset[aria-label='Set 1'] input","7");
    await edit("#field-overall textarea","Synthetic overall draft");
    await click("Complete Workout");await click("Confirm Complete Workout");
    await until("document.querySelector('[role=alert]')?.textContent.includes('Single-arm half-kneeling overhead press · set 1')");
    await click("Confirm Complete Workout");
    await until("document.querySelector('[role=alert]')?.textContent.includes('Overall Workout Notes')");
    await click("Keep my draft");await click("Confirm Complete Workout");
    await until("document.body.textContent.includes('Completed — workout saved')");
    await evaluate("window.__beforeReload=true");
    await send("Page.reload",{},sessionId);
    await until("!window.__beforeReload && document.readyState==='complete'");
    await until("document.body.textContent.includes('Completed — workout saved')");
    const state=await evaluate("JSON.parse(sessionStorage.getItem('synthetic-61-"+width+"'))");
    assert.equal(state.data.notes,"Synthetic overall draft");assert.equal(state.data.status,"completed");
    const sets=state.data.entries.filter(e=>e.kind==="strength_set");
    assert.equal(sets.length,1);assert.equal(sets[0].value.reps,7);assert.equal(sets[0].value.load,null);
    assert.equal(Object.keys(state.receipts).length,4);assert.ok(new Set(state.keys).size<state.keys.length);
    assert.ok(await evaluate(headers+"[0].textContent.includes('7–8') && "+headers+"[0].textContent.includes('✓')"));
    console.log(JSON.stringify({width,accordion:true,autoSave:true,staleRecovery:true,idempotentRetry:true,finalizedReload:true}))
  }
} finally {
  server.close();
  clearTimeout(deadline);
  await closeBrowser?.();
  browser?.kill();
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
