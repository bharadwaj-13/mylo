import http from 'node:http';
import handler from './api/index.js';

const port = Number(process.env.PORT || 8787);
http.createServer((req, res) => handler(req, res).catch(error => {
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: error.message || 'Internal error' }));
})).listen(port, '0.0.0.0', () => console.log(`Mylo control plane listening on ${port}`));
