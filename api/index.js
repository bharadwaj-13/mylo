import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (path === '/health') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'mylo' }));
    return;
  }
  if (path === '/' || path === '/quickcart-dashboard.html') {
    const html = await readFile(join(process.cwd(), 'quickcart-dashboard.html'), 'utf8');
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  if (path === '/api/twilio/whatsapp') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw).get('Body') || '';
    const reply = body ? `Mylo received: ${body}. Open the dashboard to compare stores and approve UPI payment.` : 'Mylo is ready. Try: chips and drinks under ₹200';
    res.statusCode = 200;
    res.setHeader('content-type', 'text/xml; charset=utf-8');
    res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</Message></Response>`);
    return;
  }
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'Not found' }));
}
