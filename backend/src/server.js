// backend/src/server.js
import 'dotenv/config';   // ← MUST be the very first line

import express from 'express';
import cors    from 'cors';
import morgan  from 'morgan';
import { workflowsRouter } from './routes/workflows.js';
import { approvalsRouter } from './routes/approvals.js';
import { logsRouter }      from './routes/logs.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/workflows', workflowsRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/logs',      logsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`✅ Node backend listening on http://localhost:${port}`);
});