# Mylo browser worker

This is a self-hosted Playwright/Chromium worker. It uses the stores' public web interfaces under the shopper's own session; it does not call marketplace APIs, bypass login, solve CAPTCHAs, or receive/store passwords or UPI PINs.

Deploy it on a persistent Docker host with two HTTPS endpoints:

- `https://worker.example.com` → port `8080` (private command API)
- `https://viewer.example.com` → port `6080` (noVNC browser viewer; protect it behind identity-aware access or a VPN before use)

Required environment variables: `MYLO_WORKER_SHARED_SECRET`, `MYLO_CONTROL_PLANE_URL`, and persistent `/data` storage. The same shared secret must be set as `MYLO_WORKER_SHARED_SECRET` in Vercel.

Example local run:

```bash
docker build -t mylo-worker .
docker run --rm -p 8080:8080 -p 6080:6080 -e MYLO_WORKER_SHARED_SECRET=change-me -e MYLO_CONTROL_PLANE_URL=https://mylo.example.com -v mylo-sessions:/data mylo-worker
```
