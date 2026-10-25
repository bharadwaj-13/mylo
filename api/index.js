import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const esc = value => String(value).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const auth = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script><script>(async()=>{const cfg=window.__MYLO_CONFIG__;if(!cfg?.url||!cfg?.key)return;const client=window.supabase.createClient(cfg.url,cfg.key);const box=document.createElement('div');box.id='mylo-auth';box.innerHTML='<div style="position:fixed;inset:0;background:#102119ee;z-index:9999;display:grid;place-items:center;padding:20px;font-family:system-ui"><form id="mylo-auth-form" style="background:white;border-radius:18px;padding:28px;width:min(390px,100%);box-shadow:0 20px 70px #0005"><h2 style="margin:0 0 6px">Welcome to Mylo</h2><p style="color:#6b786f">Sign in to manage your shopping agent.</p><input id="mylo-email" type="email" placeholder="Email" required style="width:100%;padding:12px;margin:7px 0;border:1px solid #dbe5de;border-radius:9px"><input id="mylo-password" type="password" placeholder="Password" minlength="6" required style="width:100%;padding:12px;margin:7px 0;border:1px solid #dbe5de;border-radius:9px"><button style="width:100%;padding:12px;background:#1f9d68;color:white;border:0;border-radius:9px;font-weight:700;margin-top:8px">Sign in</button><button id="mylo-signup" type="button" style="width:100%;padding:12px;background:#eef5f0;color:#116342;border:0;border-radius:9px;font-weight:700;margin-top:8px">Create account</button><div id="mylo-auth-status" style="color:#d95e54;margin-top:12px;font-size:13px"></div></form></div>';document.body.append(box);const form=box.querySelector('#mylo-auth-form'),status=box.querySelector('#mylo-auth-status');const email=box.querySelector('#mylo-email'),password=box.querySelector('#mylo-password');async function signup(){status.textContent='';const r=await client.auth.signUp({email:email.value,password:password.value,emailRedirectTo:location.origin});status.textContent=r.error?r.error.message:'Check your email to confirm your Mylo account.'}box.querySelector('#mylo-signup').onclick=signup;form.onsubmit=async e=>{e.preventDefault();status.textContent='';const r=await client.auth.signInWithPassword({email:email.value,password:password.value});if(r.error)status.textContent=r.error.message};const session=(await client.auth.getSession()).data.session;if(session)box.remove();client.auth.onAuthStateChange((_event,s)=>{if(s)box.remove()})})()</script>`;

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (path === '/health') { res.statusCode=200; res.setHeader('content-type','application/json'); res.end(JSON.stringify({ok:true,service:'mylo'})); return; }
  if (path === '/' || path === '/quickcart-dashboard.html') {
    let html = await readFile(join(process.cwd(), 'quickcart-dashboard.html'), 'utf8');
    const config = '<script>window.__MYLO_CONFIG__=' + JSON.stringify({url:process.env.SUPABASE_URL || '',key:process.env.SUPABASE_PUBLISHABLE_KEY || ''}) + '</script>';
    html = html.replace('</head>', config + '</head>').replace('</body>', auth + '</body>');
    res.statusCode=200; res.setHeader('content-type','text/html; charset=utf-8'); res.end(html); return;
  }
  if (path === '/api/twilio/whatsapp') {
    let raw=''; for await (const chunk of req) raw += chunk;
    const body = new URLSearchParams(raw).get('Body') || '';
    const reply = body ? `Mylo received: ${body}. Open the dashboard to compare stores and approve UPI payment.` : 'Mylo is ready. Try: chips and drinks under ₹200';
    res.statusCode=200; res.setHeader('content-type','text/xml; charset=utf-8'); res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc(reply)}</Message></Response>`); return;
  }
  res.statusCode=404; res.setHeader('content-type','application/json'); res.end(JSON.stringify({error:'Not found'}));
}
