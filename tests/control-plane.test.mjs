import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler from '../api/index.js';

function response() {
  return { statusCode: 200, headers: {}, body: '', setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(value = '') { this.body += value; } };
}
function request(url, method = 'GET', body = '') {
  const req = Readable.from(body ? [body] : []); req.url = url; req.method = method; req.headers = { host: 'localhost:8787' }; return req;
}

test('health endpoint reports control-plane status', async () => {
  const res = response(); await handler(request('/health'), res);
  assert.equal(res.statusCode, 200); assert.equal(JSON.parse(res.body).service, 'mylo-control-plane');
});

test('dashboard asset is available through the serverless handler', async () => {
  const res = response(); await handler(request('/assets/dashboard.js'), res);
  assert.equal(res.statusCode, 200); assert.match(res.body, /Link WhatsApp number/);
});
