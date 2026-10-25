import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8787);
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'quickcart-demo-token';

const state = {
  profile: { phone: process.env.DEMO_PHONE || 'demo-user', name: 'Aanya', location: 'Bengaluru · 560001' },
  requests: [],
  orders: [],
  referrals: { code: 'quickcart.app/aanya100', invites: 3, earned: 300 },
  stores: [
    { id: 'blinkit', name: 'Blinkit', connected: true, adapter: 'demo' },
    { id: 'zepto', name: 'Zepto', connected: true, adapter: 'demo' },
    { id: 'instamart', name: 'Instamart', connected: true, adapter: 'demo' }
  ]
};

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function id(prefix) { return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }
function now() { return new Date().toISOString(); }
function parseBudget(text) { const m = text.match(/(?:₹|rs\.?\s*|under\s*)\s*([\d,]+)/i); return m ? Number(m[1].replace(',', '')) : 300; }
function buildQuotes(text) {
  const budget = parseBudget(text);
  const base = Math.min(budget, 187);
  return [
    { store: 'blinkit', storeName: 'Blinkit', total: base, eta: 12, label: 'Best total value', cartUrl: 'https://blinkit.com/cart/demo' },
    { store: 'zepto', storeName: 'Zepto', total: base + 7, eta: 10, label: 'Fastest delivery', cartUrl: 'https://zeptonow.com/cart/demo' },
    { store: 'instamart', storeName: 'Instamart', total: base + 22, eta: 18, label: 'Higher delivery fee', cartUrl: 'https://swiggy.com/instamart/cart/demo' }
  ].map((q, i) => ({ ...q, recommended: i === 0, requestText: text, budget }));
}
function createRequest(text, source = 'dashboard') {
  const request = { id: id('req'), text, source, status: 'compared', createdAt: now(), quotes: buildQuotes(text) };
  state.requests.unshift(request);
  return request;
}
function messageForRequest(request) {
  const q = request.quotes.find(x => x.recommended);
  return `I found the best basket on ${q.storeName}: ₹${q.total}, delivery in ${q.eta} minutes. I can prepare the cart and send you to ${q.storeName} for UPI payment. Reply APPROVE to continue.`;
}
function approveRequest(request) {
  const q = request.quotes.find(x => x.recommended);
  request.status = 'upi_handoff_ready'; request.approvedAt = now(); request.selectedQuote = q;
  request.cartUrl = q.cartUrl;
  return request;
}
async function sendWhatsApp(phone, text) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !phone) return { sent: false, mode: 'demo', text };
  const response = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } })
  });
  return { sent: response.ok, status: response.status };
}

async function body(req) { let data = ''; for await (const chunk of req) data += chunk; try { return JSON.parse(data || '{}'); } catch { return {}; } }
async function formBody(req) { let data = ''; for await (const chunk of req) data += chunk; return Object.fromEntries(new URLSearchParams(data)); }
function xmlEscape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function twimlMessage(text) { return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`; }
function inboundReply(text, source = 'twilio') {
  const normalized = String(text || '').trim();
  if (/^(done|paid|payment done)$/i.test(normalized)) {
    const previous = state.requests.find(x => x.source === source && x.status === 'upi_handoff_ready');
    if (!previous) return 'I could not find a pending payment. Ask me to build a cart first.';
    previous.status = 'ordered'; previous.paidAt = now();
    const order = { id: id('order'), requestId: previous.id, store: previous.selectedQuote.storeName, total: previous.selectedQuote.total, status: 'placed', createdAt: now() };
    state.orders.unshift(order);
    return `Payment noted. Your ${order.store} order is placed for ₹${order.total}. I’ll send tracking updates here.`;
  }
  const previous = state.requests.find(x => x.source === source && ['compared', 'awaiting_approval'].includes(x.status));
  if (/^(approve|yes|go ahead|proceed)$/i.test(normalized) && previous) {
    const request = approveRequest(previous);
    return `Cart ready. Pay in the official app using UPI, then send DONE here. ${request.cartUrl}`;
  }
  const request = createRequest(normalized, source); request.status = 'awaiting_approval';
  return messageForRequest(request);
}
async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'quickcart-agent', time: now() });
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state);
  if (req.method === 'GET' && url.pathname === '/api/whatsapp/webhook') {
    if (url.searchParams.get('hub.verify_token') !== verifyToken) return json(res, 403, { error: 'invalid verify token' });
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end(url.searchParams.get('hub.challenge') || ''); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/twilio/whatsapp') {
    const input = await formBody(req);
    const reply = inboundReply(input.Body || '', 'twilio');
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
    res.end(twimlMessage(reply));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/requests') {
    const input = await body(req); if (!input.text) return json(res, 400, { error: 'text is required' });
    return json(res, 201, createRequest(input.text, input.source || 'dashboard'));
  }
  const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/(approve|handoff)$/);
  if (req.method === 'POST' && requestMatch) {
    const request = state.requests.find(x => x.id === requestMatch[1]); if (!request) return json(res, 404, { error: 'request not found' });
    approveRequest(request); return json(res, 200, { request, message: `Open this cart and complete UPI payment: ${request.cartUrl}` });
  }
  if (req.method === 'POST' && url.pathname === '/api/whatsapp/webhook') {
    const input = await body(req); const text = input.text || input.message?.text?.body || '';
    if (!text) return json(res, 200, { ok: true, ignored: true });
    const phone = input.from || input.message?.from || state.profile.phone;
    if (/^(done|paid|payment done)$/i.test(text.trim())) {
      const previous = state.requests.find(x => x.source === 'whatsapp' && x.status === 'upi_handoff_ready');
      if (!previous) return json(res, 200, { ok: true, reply: 'I could not find a pending payment. Ask me to build a cart first.' });
      previous.status = 'ordered'; previous.paidAt = now();
      const order = { id: id('order'), requestId: previous.id, store: previous.selectedQuote.storeName, total: previous.selectedQuote.total, status: 'placed', createdAt: now() };
      state.orders.unshift(order); const reply = `Payment noted. Your ${order.store} order is placed for ₹${order.total}. I’ll send tracking updates here.`;
      const delivery = await sendWhatsApp(phone, reply); return json(res, 200, { ok: true, reply, delivery, order });
    }
    const previous = state.requests.find(x => x.source === 'whatsapp' && ['compared', 'awaiting_approval'].includes(x.status));
    if (/^(approve|yes|go ahead|proceed)$/i.test(text.trim()) && previous) {
      const request = approveRequest(previous); const reply = `Cart ready. Pay in the official app using UPI, then send DONE here. ${request.cartUrl}`;
      const delivery = await sendWhatsApp(phone, reply); return json(res, 200, { ok: true, reply, delivery, request });
    }
    const request = createRequest(text, 'whatsapp'); request.status = 'awaiting_approval'; const reply = messageForRequest(request);
    const delivery = await sendWhatsApp(phone, reply); return json(res, 200, { ok: true, reply, delivery, request });
  }
  if (req.method === 'GET') {
    const safe = normalize(url.pathname === '/' ? '/quickcart-dashboard.html' : url.pathname);
    if (safe.includes('..')) return json(res, 400, { error: 'bad path' });
    try { const data = await readFile(join(root, safe)); const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' }[extname(safe)] || 'application/octet-stream'; res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); res.end(data); return; } catch {}
  }
  json(res, 404, { error: 'not found' });
}

export { serve };

if (!process.env.VERCEL) {
  http.createServer((req, res) => serve(req, res).catch(err => json(res, 500, { error: err.message }))).listen(port, '0.0.0.0', () => console.log(`QuickCart agent running on port ${port}`));
}
