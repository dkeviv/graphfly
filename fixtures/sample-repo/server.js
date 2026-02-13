import express from 'express';
import { a } from './a';

const app = express();

app.get('/health', (req, res) => {
  res.json({ ok: true, value: a() });
});

export { app };

