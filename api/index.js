import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const xmlEscape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
const twiml = text => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`;
async function readBody(req) { let raw = ''; for await (const part of req) raw += part; return raw; }
async function readJson(req) { try { return JSON.parse(await readBody(req) || '{}'); } catch { return {}; } }
function config() { return { url: process.env.SUPABASE_URL || '', anon: process.env.SUPABASE_PUBLISHABLE_KEY || '', service: process.env.SUPABASE_SERVICE_ROLE_KEY || '' }; }
async function db(path, { method = 'GET', body, service = false } = {}) {
  const c = config(); if (!c.url || !(service ? c.service : c.anon)) throw new Error('Supabase is not configured');
  const key = service ? c.service : c.anon;
  const response = await fetch(`${c.url}/rest/v1/${path}`, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const raw = await response.text(); let value; try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) throw new Error(value?.message || value?.hint || `Supabase request failed (${response.status})`);
  return value;
}
async function userFromRequest(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const c = config();
  if (!token || !c.url || !c.anon) return null;
  const response = await fetch(`${c.url}/auth/v1/user`, { headers: { apikey: c.anon, authorization: `Bearer ${token}` } });
  return response.ok ? response.json() : null;
}
async function recordEvent(jobId, eventType, message, metadata = {}) { return db('job_events', { method: 'POST', service: true, body: { job_id: jobId, event_type: eventType, message, metadata } }); }
async function findUserForWhatsApp(from) {
  const digits = String(from || '').replace(/\D/g, ''); if (!digits) return null;
  const rows = await db(`profiles?select=id,phone&phone=eq.${encodeURIComponent(`+${digits}`)}`, { service: true }); return rows?.[0] || null;
}
function workerAuthorized(req) { return Boolean(process.env.MYLO_WORKER_SHARED_SECRET) && req.headers['x-mylo-worker-secret'] === process.env.MYLO_WORKER_SHARED_SECRET; }
async function callWorker(path, input) {
  const url = process.env.MYLO_WORKER_URL; const secret = process.env.MYLO_WORKER_SHARED_SECRET;
  if (!url || !secret) throw new Error('Browser worker is not configured yet');
  const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mylo-worker-secret': secret }, body: JSON.stringify(input) });
  const value = await response.json().catch(() => ({})); if (!response.ok) throw new Error(value.error || 'Browser worker request failed'); return value;
}
function verifyTwilio(req, raw) {
  const token = process.env.TWILIO_AUTH_TOKEN; if (!token) return true;
  const signature = req.headers['x-twilio-signature']; if (!signature) return false;
  const url = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}${req.url}`;
  const form = new URLSearchParams(raw); const signed = url + [...form.keys()].sort().map(k => `${k}${form.get(k)}`).join('');
  const expected = crypto.createHmac('sha1', token).update(signed).digest('base64');
  return expected.length === String(signature).length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
}
const authOverlay = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script>(async()=>{const cfg=window.__MYLO_CONFIG__;if(!cfg?.url||!cfg?.key)return;const client=window.supabase.createClient(cfg.url,cfg.key);window.myloSupabase=client;const box=document.createElement('div');box.id='mylo-auth';box.innerHTML='<div style="position:fixed;inset:0;background:#102119ee;z-index:9999;display:grid;place-items:center;padding:20px;font-family:system-ui"><form id="mylo-auth-form" style="background:white;border-radius:18px;padding:28px;width:min(390px,100%);box-shadow:0 20px 70px #0005"><h2 style="margin:0 0 6px">Welcome to Mylo</h2><p style="color:#6b786f">Sign in to manage your shopping agent.</p><button id="mylo-google" type="button" style="width:100%;padding:12px;background:#fff;color:#26332c;border:1px solid #dbe5de;border-radius:9px;font-weight:700;margin:8px 0 12px">G&nbsp;&nbsp; Continue with Google</button><div style="display:flex;align-items:center;gap:9px;color:#829087;font-size:12px;margin:0 0 12px"><span style="height:1px;background:#e3eae5;flex:1"></span>or email<span style="height:1px;background:#e3eae5;flex:1"></span></div><input id="mylo-email" type="email" placeholder="Email" required style="width:100%;padding:12px;margin:7px 0;border:1px solid #dbe5de;border-radius:9px"><input id="mylo-password" type="password" placeholder="Password" minlength="6" required style="width:100%;padding:12px;margin:7px 0;border:1px solid #dbe5de;border-radius:9px"><button style="width:100%;padding:12px;background:#1f9d68;color:white;border:0;border-radius:9px;font-weight:700;margin-top:8px">Sign in</button><button id="mylo-signup" type="button" style="width:100%;padding:12px;background:#eef5f0;color:#116342;border:0;border-radius:9px;font-weight:700;margin-top:8px">Create account</button><div id="mylo-auth-status" style="color:#d95e54;margin-top:12px;font-size:13px"></div></form></div>';document.body.append(box);const form=box.querySelector('#mylo-auth-form'),status=box.querySelector('#mylo-auth-status'),email=box.querySelector('#mylo-email'),password=box.querySelector('#mylo-password');async function signup(){const r=await client.auth.signUp({email:email.value,password:password.value,emailRedirectTo:location.origin});status.textContent=r.error?r.error.message:'Check your email to confirm your Mylo account.'}box.querySelector('#mylo-signup').onclick=signup;box.querySelector('#mylo-google').onclick=async()=>{status.textContent='';const r=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin}});if(r.error)status.textContent=r.error.message};form.onsubmit=async e=>{e.preventDefault();const r=await client.auth.signInWithPassword({email:email.value,password:password.value});if(r.error)status.textContent=r.error.message};const session=(await client.auth.getSession()).data.session;if(session)box.remove();client.auth.onAuthStateChange((_event,s)=>{if(s){box.remove();window.dispatchEvent(new Event('mylo-authenticated'))}})})()</script>`;

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  try {
    if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'mylo-control-plane', browserWorker: Boolean(process.env.MYLO_WORKER_URL) });
    if (req.method === 'GET' && path === '/assets/dashboard.js') { res.statusCode = 200; res.setHeader('content-type', 'text/javascript; charset=utf-8'); return res.end(await readFile(join(root, 'dashboard.js'))); }
    if (path === '/' || path === '/quickcart-dashboard.html') {
      let html = await readFile(join(root, 'quickcart-dashboard.html'), 'utf8');
      const publicConfig = `<script>window.__MYLO_CONFIG__=${JSON.stringify({ url: process.env.SUPABASE_URL || '', key: process.env.SUPABASE_PUBLISHABLE_KEY || '', viewerUrl: process.env.MYLO_BROWSER_VIEWER_URL || '' })}</script>`;
      html = html.replace('</head>', `${publicConfig}</head>`).replace('</body>', `<script src="/assets/dashboard.js"></script>${authOverlay}</body>`);
      res.statusCode = 200; res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(html);
    }
    if (req.method === 'POST' && path === '/api/twilio/whatsapp') {
      const raw = await readBody(req); if (!verifyTwilio(req, raw)) { res.statusCode = 403; return res.end(twiml('Request could not be verified.')); }
      const form = new URLSearchParams(raw); const message = (form.get('Body') || '').trim(); const from = form.get('From') || '';
      await db('webhook_messages', { method: 'POST', service: true, body: { provider: 'twilio', provider_message_id: form.get('MessageSid') || null, from_address: from, body: message } }).catch(() => {});
      const person = await findUserForWhatsApp(from).catch(() => null);
      if (!person) { res.statusCode = 200; res.setHeader('content-type', 'text/xml; charset=utf-8'); return res.end(twiml('Welcome to Mylo. Sign in at mylo.tinkeringspaces.com, add this WhatsApp number in Settings, then message me again.')); }
      if (!message) { res.statusCode = 200; res.setHeader('content-type', 'text/xml; charset=utf-8'); return res.end(twiml('Tell me what you need, for example: chips and drinks under ₹200.')); }
      const jobs = await db('shopping_jobs', { method: 'POST', service: true, body: { user_id: person.id, source: 'whatsapp', request_text: message } });
      await recordEvent(jobs[0].id, 'job_queued', 'Your WhatsApp request was queued for the browser operator.');
      res.statusCode = 200; res.setHeader('content-type', 'text/xml; charset=utf-8'); return res.end(twiml('Got it. Mylo is opening your connected stores now. I’ll ask you to approve the best cart before any UPI payment.'));
    }
    if (req.method === 'POST' && path === '/api/worker/events') {
      if (!workerAuthorized(req)) return json(res, 401, { error: 'unauthorized' }); const input = await readJson(req);
      if (!input.jobId || !input.eventType || !input.message) return json(res, 400, { error: 'jobId, eventType, and message are required' });
      await recordEvent(input.jobId, input.eventType, input.message, input.metadata || {});
      if (input.status) await db(`shopping_jobs?id=eq.${encodeURIComponent(input.jobId)}`, { method: 'PATCH', service: true, body: { status: input.status } });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/api/browser/command') {
      const user = await userFromRequest(req); if (!user) return json(res, 401, { error: 'sign in required' }); const input = await readJson(req);
      const rows = await db(`shopping_jobs?id=eq.${encodeURIComponent(input.jobId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`, { service: true });
      if (!rows?.length) return json(res, 404, { error: 'job not found' }); return json(res, 200, await callWorker('/commands', input));
    }
    return json(res, 404, { error: 'not found' });
  } catch (error) { return json(res, 500, { error: error.message || 'Internal error' }); }
}
