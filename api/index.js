import { serve } from '../server.js';

export default async function handler(req, res) {
  try {
    await serve(req, res);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error.message }));
  }
}
