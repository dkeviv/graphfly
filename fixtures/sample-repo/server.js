import express from 'express';
import { a, greet } from './a';

const app = express();

app.get('/health', (req, res) => {
  res.json({ ok: true, value: a(), greeting: greet('world', 'casual', 0) });
});

export { app };
