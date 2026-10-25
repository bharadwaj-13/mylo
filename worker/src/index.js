import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const port = Number(process.env.PORT || 8080);
const secret = process.env.MYLO_WORKER_SHARED_SECRET || '';
const controlUrl = (process.env.MYLO_CONTROL_PLANE_URL || '').replace(/\/$/, '');
const sessionDir = process.env.SESSION_DIR || '/data/sessions';
const sessions = new Map();
const stores = {
  blinkit: { name: 'Blinkit', url: 'https://blinkit.com/' },
  zepto: { name: 'Zepto', url: 'https://www.zepto.com/' },
  instamart: { name: 'Instamart', url: 'https://www.swiggy.com/instamart' }
};

function send(res, code, value) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function allowed(req) { return Boolean(secret) && req.headers['x-mylo-worker-secret'] === secret; }
async function payload(req) { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function safeStore(name) { if (!stores[name]) throw new Error(`Unsupported store: ${name}`); return stores[name]; }
async function event(jobId, eventType, message, metadata = {}) {
  if (!controlUrl || !secret) return;
  await fetch(`${controlUrl}/api/worker/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mylo-worker-secret': secret }, body: JSON.stringify({ jobId, eventType, message, metadata }) }).catch(() => {});
}
async function supabase(path, { method = 'GET', body } = {}) {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for job processing');
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const raw = await response.text(); let value; try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) throw new Error(value?.message || `Supabase request failed (${response.status})`); return value;
}
async function jobEvent(jobId, eventType, message, metadata = {}) {
  await supabase('job_events', { method: 'POST', body: { job_id: jobId, event_type: eventType, message, metadata } });
}
async function patchJob(jobId, body) { return supabase(`shopping_jobs?id=eq.${encodeURIComponent(jobId)}`, { method: 'PATCH', body }); }

async function getSession(jobId, store) {
  const key = `${jobId}:${store}`;
  if (sessions.has(key)) return sessions.get(key);
  await mkdir(sessionDir, { recursive: true });
  const context = await chromium.launchPersistentContext(join(sessionDir, key), {
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = context.pages()[0] || await context.newPage();
  const session = { context, page, store, createdAt: new Date().toISOString() };
  sessions.set(key, session);
  return session;
}
async function gotoStore(jobId, store) {
  const target = safeStore(store);
  const session = await getSession(jobId, store);
  await session.page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await event(jobId, 'browser_opened', `${target.name} opened in your private browser session.`, { store });
  return session;
}
async function capture(jobId, store, page) {
  const file = join(sessionDir, `${jobId}-${store}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}
async function search(page, query) {
  const candidates = ['input[type="search"]', 'input[placeholder*="Search" i]', 'input[aria-label*="Search" i]'];
  for (const selector of candidates) {
    const box = page.locator(selector).first();
    if (await box.count() && await box.isVisible().catch(() => false)) { await box.fill(query); await box.press('Enter'); return true; }
  }
  return false;
}

async function handleCommand(input) {
  const { jobId, store, action } = input;
  if (!jobId || !store || !action) throw new Error('jobId, store, and action are required');
  const session = await gotoStore(jobId, store);
  if (action === 'start_login') {
    await event(jobId, 'needs_login', `Complete ${stores[store].name} login in the browser viewer. Mylo never stores your password.`, { store, viewerPath: '/vnc.html' });
    return { status: 'needs_login', viewerPath: '/vnc.html' };
  }
  if (action === 'search') {
    const ok = await search(session.page, input.query || '');
    await capture(jobId, store, session.page);
    if (!ok) await event(jobId, 'needs_user_action', `Search box was not found on ${stores[store].name}; continue in the browser viewer.`, { store });
    else await event(jobId, 'search_completed', `Searched ${stores[store].name} for “${input.query}”.`, { store, query: input.query });
    return { status: ok ? 'searched' : 'needs_user_action' };
  }
  if (action === 'capture') { const screenshot = await capture(jobId, store, session.page); return { status: 'captured', screenshot }; }
  if (action === 'close') { await session.context.close(); sessions.delete(`${jobId}:${store}`); return { status: 'closed' }; }
  throw new Error(`Unknown action: ${action}`);
}

async function processQueuedJobs() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const jobs = await supabase('shopping_jobs?status=eq.queued&select=id,request_text,stores&order=created_at.asc&limit=2');
  for (const job of jobs || []) {
    const claimed = await supabase(`shopping_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.queued`, { method: 'PATCH', body: { status: 'running' } });
    if (!claimed?.length) continue;
    try {
      await jobEvent(job.id, 'browser_starting', 'Mylo is opening your private store browser sessions.');
      for (const store of job.stores || []) {
        const session = await gotoStore(job.id, store);
        const foundSearch = await search(session.page, job.request_text);
        await capture(job.id, store, session.page);
        await jobEvent(job.id, foundSearch ? 'store_search_opened' : 'store_needs_input', foundSearch ? `Opened ${stores[store].name} and searched for your request.` : `${stores[store].name} needs a quick manual search in the browser viewer.`, { store });
      }
      await patchJob(job.id, { status: 'needs_user_action' });
      await jobEvent(job.id, 'needs_user_action', 'Your store tabs are ready. Sign in or complete any location, OTP, or challenge directly in the secure browser viewer.');
    } catch (error) {
      await patchJob(job.id, { status: 'failed', error_code: 'browser_error', error_message: error.message });
      await jobEvent(job.id, 'failed', `Browser run stopped: ${error.message}`);
    }
  }
}

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://worker').pathname;
  if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, service: 'mylo-browser-worker', sessions: sessions.size });
  if (req.method === 'POST' && path === '/commands') {
    if (!allowed(req)) return send(res, 401, { error: 'unauthorized' });
    try { return send(res, 200, await handleCommand(await payload(req))); } catch (error) { return send(res, 400, { error: error.message }); }
  }
  return send(res, 404, { error: 'not found' });
}).listen(port, () => console.log(`Mylo browser worker listening on ${port}`));

setInterval(() => processQueuedJobs().catch(error => console.error('job poll failed', error.message)), 5000);
processQueuedJobs().catch(error => console.error('initial job poll failed', error.message));
