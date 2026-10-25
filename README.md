# Mylo

Mylo is a WhatsApp-first, browser-operated quick-commerce assistant for India. It keeps the shopper in control: Mylo opens supported retailers in a private browser session, compares carts, then sends the shopper to the official checkout to approve UPI. It never receives or stores a password, OTP, or UPI PIN.

## What is in this repository

- Vercel control plane: dashboard, Supabase authentication, Twilio WhatsApp webhook, job/event APIs
- Supabase schema with row-level security for users, store connections, jobs, quotes, events and OTP challenges
- A self-hosted Docker browser worker using Playwright and an optional noVNC viewer
- WhatsApp text → shopping job → browser tabs → user login/location/OTP → cart comparison → official UPI handoff flow

## Deploy the control plane

1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. In Vercel, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `MYLO_WORKER_SHARED_SECRET`.
3. For Google sign-in, enable **Google** under Supabase Authentication → Sign In / Providers, then add its Supabase callback URL in Google Cloud OAuth credentials. Mylo calls Supabase's Google OAuth flow directly.
4. Point the Twilio WhatsApp Sandbox inbound webhook at `https://your-domain/api/twilio/whatsapp` using HTTP POST. If `TWILIO_AUTH_TOKEN` is set, requests are signature-verified.
5. In Mylo, create an account and add/link the WhatsApp number you message from. A Settings form is the next UI addition for that link.

## Deploy the browser worker

Vercel is the control plane only. Logged-in browser sessions need a persistent Docker host and persistent disk; deploy [`worker/`](worker/) to a VM, Railway, Render, Fly.io, or another Docker service with volume storage. See [`worker/README.md`](worker/README.md).

Set these worker variables:

```bash
MYLO_WORKER_SHARED_SECRET=same-value-as-vercel
MYLO_CONTROL_PLANE_URL=https://your-mylo-domain
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Set `MYLO_WORKER_URL` and `MYLO_BROWSER_VIEWER_URL` in Vercel once the worker is live. Protect the viewer URL with a VPN or identity-aware proxy before using it; it is the interactive browser surface where a shopper enters a retailer OTP.

## Local development

```bash
cp .env.example .env
npm start
```

Then open `http://localhost:8787`. The browser worker is separate:

```bash
cd worker
docker build -t mylo-worker .
```

## Safety model

Mylo uses the websites’ normal browser interfaces under the customer’s own account. It deliberately pauses for OTPs, CAPTCHAs, location prompts and payment. It does not bypass access controls, simulate payment approval, scrape around anti-bot protections, or retain raw credentials.
