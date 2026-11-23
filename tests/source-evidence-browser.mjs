// Synthetic browser → HTTP adapter → restricted PostgreSQL → fresh readback.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const require=createRequire(import.meta.url)
const {build}=createRequire(require.resolve('tsx'))('esbuild')
const binary=process.env.CHROMIUM_BIN
assert.ok(binary,'CHROMIUM_BIN required')
const work=await mkdtemp(join(tmpdir(),'stunna-source-'))
let browser,server,closeBrowser
const errors=[]
const deadline=setTimeout(()=>{browser?.kill();server?.kill();process.exitCode=1},90000)
try {
  await build({entryPoints:['tests/fixtures/source-evidence-browser.tsx'],bundle:true,outfile:join(work,'source.js')})
  await writeFile(join(work,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:16px Arial,sans-serif;overflow-wrap:anywhere}select{max-width:100%}</style><link rel="stylesheet" href="/source.css"><div id="root"></div><script src="source.js"></script></html>')
  server=spawn(process.execPath,['--conditions=react-server','--import','tsx','tests/fixtures/source-evidence-server.ts',work],{stdio:['ignore','pipe','inherit']})
  const url=await new Promise((resolve,reject)=>{
    let output='';server.stdout.on('data',data=>{output+=data;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0])})
    server.once('error',reject);server.once('exit',code=>reject(Error('Synthetic server exited '+code)))
  })
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
      if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
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


  await send('Runtime.enable',{},sessionId)
  async function evaluate(expression) {
    const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId)
    if(r.exceptionDetails) throw Error(r.exceptionDetails.text)
    return r.result.value
  }
  async function until(expression) {
    for(let i=0;i<80;i++){if(await evaluate('!!document.body && ('+expression+')'))return;await delay(50)}
    throw Error('Browser condition not reached: '+expression)
  }
  const click=label=>evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)}));if(!b||b.disabled)throw Error('button unavailable');b.click()})()`)
  const probe=(query='')=>evaluate("fetch('/probe"+query+"').then(r=>r.json())")
  const waitText=text=>until('document.body.innerText.includes('+JSON.stringify(text)+')')
  const retry=()=>click('Retry confirmation')
  async function capture(width,name) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true},sessionId)
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
    const controls=await evaluate("Array.from(document.querySelectorAll('label,button,summary')).filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect().height)")
    assert.ok(controls.every(h=>h>=44),JSON.stringify(controls))
    if(process.env.SCREENSHOT_DIR) {
      await mkdir(process.env.SCREENSHOT_DIR,{recursive:true})
      const shot=await send('Page.captureScreenshot',{format:'png'},sessionId)
      await writeFile(join(process.env.SCREENSHOT_DIR,name+'-'+width+'.png'),Buffer.from(shot.data,'base64'))
    }
  }
  await send('Page.navigate',{url},sessionId)
  await until("document.querySelectorAll('input:checked').length===2")
  assert.equal((await probe()).links,0)
  for(const width of [375,390]) await capture(width,'selection')
  // Owner can correct a suggestion without issuing any write.
  await evaluate("document.querySelector('input[value=\"502\"]').click()")
  await until("document.querySelectorAll('input:checked').length===1")
  await evaluate("document.querySelector('input[value=\"502\"]').click()")
  await probe('?fail=before501')
  await click('Confirm selected')
  await waitText('could not be verified')
  assert.equal((await probe()).links,0)
  await retry()
  await waitText('could not be verified')
  assert.equal((await probe()).links,1) // committed first write, stale readback
  await probe('?readback=verified&fail=before502')
  await retry()
  await waitText('First recording saved. Save could not be verified')
  assert.equal((await probe()).audits,1)
  await send('Page.navigate',{url},sessionId)
  await waitText('Saved · Garmin')
  await until("document.querySelectorAll('input:checked').length===1")
  assert.equal(await evaluate("document.querySelector('input:checked').value"),'502')
  await probe('?fail=after502')
  await click('Confirm selected')
  await waitText('could not be verified')
  await retry()
  await waitText('Selected recordings saved and re-read.')
  const state=await probe()
  assert.deepEqual([state.links,state.audits],[2,2])
  assert.equal(state.confirmationKeys.length,6)
  assert.equal(new Set(state.confirmationKeys.slice(0,3)).size,1)
  assert.equal(new Set(state.confirmationKeys.slice(3)).size,1)
  const saved=await evaluate("fetch('/results').then(r=>r.json())")
  assert.equal(saved.status,'completed');assert.equal(saved.sessionRevision,2)
  assert.equal(new Set(saved.sourceResult.evidence.map(e=>e.id)).size,2)
  assert.equal(saved.sourceResult.reconciled.summary.find(m=>m.field==='distanceMeters').sourceId,'502')
  await send('Page.navigate',{url},sessionId)
  await waitText('Workout summary')
  assert.equal(await evaluate("document.querySelectorAll('.device-metrics dt').length"),2)
  for(const width of [375,390]) {
    await evaluate("document.querySelectorAll('details').forEach(e=>e.open=false)")
    await capture(width,'summary')
    await evaluate("document.querySelectorAll('details').forEach(e=>e.open=true)")
    await capture(width,'detail')
    console.log(JSON.stringify({width,verifiedPair:true,explicitConfirmation:true,partialReload:true,sameRetryKeys:true,links:2,audits:2,overflow:false}))
  }
  assert.deepEqual(errors,[])
}finally{
  clearTimeout(deadline)
  if(closeBrowser)await closeBrowser()
  browser?.kill();server?.kill()
  await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
