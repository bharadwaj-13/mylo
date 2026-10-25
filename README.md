# QuickCart prototype

Open `quickcart-dashboard.html` in a browser. It is a self-contained clickable prototype for the Instinct-style quick-commerce agent. A runnable local agent server is included in `server.js`.

- Overview dashboard with savings, activity, orders, and connected stores
- New shopping request flow
- Store comparison with total price and delivery-time tradeoffs
- Cart preparation followed by a UPI handoff state
- Account, order, referral, and settings entry points for the next implementation phase

Run the local agent with Node 20+:

```bash
npm start
```

Then open `http://localhost:8787`. The server exposes:

- `GET /health` — service health
- `GET /api/state` — dashboard state
- `POST /api/requests` with `{ "text": "chips and drinks under ₹200" }` — create a shopping request
- `POST /api/requests/:id/approve` — prepare the selected cart and UPI handoff
- `GET/POST /api/whatsapp/webhook` — Meta WhatsApp webhook verification and inbound-message simulation
- `POST /api/twilio/whatsapp` — Twilio WhatsApp Sandbox inbound webhook (returns TwiML)

The store data and cart URLs are demo adapters. The production layer replaces those adapters with authenticated quick-commerce integrations or a browser/Android automation worker, then sends the user to the official app for UPI payment. The agent never receives a UPI PIN.

For Twilio Sandbox testing, expose the server over HTTPS and set the Twilio inbound-message webhook to `/api/twilio/whatsapp` with HTTP POST. The current Twilio handler accepts the Sandbox's form-encoded `Body` and replies with TwiML.
