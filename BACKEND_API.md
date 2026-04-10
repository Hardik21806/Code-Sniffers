# Backend API — Node.js (Express + Supabase)

## Setup

```bash
cd backend
npm install express cors morgan dotenv axios @supabase/supabase-js body-parser
```

---

## File: backend/.env.example

```env
# Copy this file to .env and fill in real values
# NEVER commit .env to git

PORT=4000
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
ORCHESTRATOR_URL=http://localhost:8000
```

---

## File: backend/src/supabaseClient.js

```js
// backend/src/supabaseClient.js
// dotenv is loaded BEFORE this file in server.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing Supabase env vars. Check backend/.env has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
```

---

## File: backend/src/server.js

```js
// backend/src/server.js
// ──────────────────────────────────────────────────
// IMPORTANT: dotenv MUST be imported first so that
// all process.env reads in other modules are populated.
// ──────────────────────────────────────────────────
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { json } from 'body-parser';

import { workflowsRouter } from './routes/workflows.js';
import { approvalsRouter } from './routes/approvals.js';
import { logsRouter } from './routes/logs.js';

const app = express();

app.use(cors());
app.use(json({ limit: '2mb' }));
app.use(morgan('dev'));

app.use('/api/workflows', workflowsRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/logs', logsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Node backend running at http://localhost:${port}`);
});
```

---

## File: backend/src/routes/workflows.js

```js
// backend/src/routes/workflows.js
import express from 'express';
import axios from 'axios';
import { supabase } from '../supabaseClient.js';

export const workflowsRouter = express.Router();

// Helper: proxy requests to Python orchestrator
async function callOrchestrator(path, payload) {
  const baseUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';
  try {
    const { data } = await axios.post(`${baseUrl}${path}`, payload, {
      timeout: 30000,
    });
    return data;
  } catch (err) {
    const msg = err.response?.data?.detail || err.message;
    throw new Error(`Orchestrator error on ${path}: ${msg}`);
  }
}

// ────────────────────────────────────────────────────────────
// POST /api/workflows/plan
// Body: { name, description, owner_id }
// Calls Python Planner Agent → returns DAG + suggestions
// ────────────────────────────────────────────────────────────
workflowsRouter.post('/plan', async (req, res) => {
  try {
    const { name, description, owner_id } = req.body;
    if (!name || !description || !owner_id) {
      return res.status(400).json({ error: 'name, description, owner_id are required' });
    }

    const plan = await callOrchestrator('/plan', { name, description, owner_id });
    return res.status(200).json(plan);
  } catch (err) {
    console.error('[POST /plan]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/workflows
// Body: { name, description, owner_id, dag_json }
// Saves a planned DAG as a workflow in Supabase
// ────────────────────────────────────────────────────────────
workflowsRouter.post('/', async (req, res) => {
  try {
    const { name, description, owner_id, dag_json } = req.body;
    if (!name || !owner_id || !dag_json) {
      return res.status(400).json({ error: 'name, owner_id, dag_json are required' });
    }

    const { data, error } = await supabase
      .from('workflows')
      .insert({ name, description, owner_id, dag_json, version: 1 })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return res.status(201).json(data);
  } catch (err) {
    console.error('[POST /workflows]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/workflows/:id
// ────────────────────────────────────────────────────────────
workflowsRouter.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Workflow not found' });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/workflows/:id/runs
// ────────────────────────────────────────────────────────────
workflowsRouter.get('/:id/runs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('workflow_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/workflows/:id/execute
// Body: { started_by (userId), input_context, mode: 'live'|'dry-run' }
// Creates a run in Supabase, then kicks off the Executor Agent
// ────────────────────────────────────────────────────────────
workflowsRouter.post('/:id/execute', async (req, res) => {
  try {
    const workflowId = req.params.id;
    const { started_by, input_context = {}, mode = 'live' } = req.body;

    if (!started_by) {
      return res.status(400).json({ error: 'started_by (userId) is required' });
    }

    // Load workflow to get version
    const { data: workflow, error: wfErr } = await supabase
      .from('workflows')
      .select('id, version, dag_json')
      .eq('id', workflowId)
      .single();

    if (wfErr) return res.status(404).json({ error: 'Workflow not found' });

    // Create run record
    const { data: run, error: runErr } = await supabase
      .from('workflow_runs')
      .insert({
        workflow_id: workflow.id,
        version: workflow.version,
        status: 'queued',
        mode,
        started_by,
        input_context,
      })
      .select()
      .single();

    if (runErr) throw new Error(runErr.message);

    // Trigger Python Executor Agent (fire-and-forget)
    const orchestratorResp = await callOrchestrator('/execute', {
      run_id: run.id,
      workflow_id: workflowId,
      mode,
    });

    return res.status(202).json({ run, orchestrator: orchestratorResp });
  } catch (err) {
    console.error('[POST /:id/execute]', err.message);
    return res.status(500).json({ error: err.message });
  }
});
```

---

## File: backend/src/routes/approvals.js

```js
// backend/src/routes/approvals.js
import express from 'express';
import axios from 'axios';
import { supabase } from '../supabaseClient.js';

export const approvalsRouter = express.Router();

// ────────────────────────────────────────────────────────────
// GET /api/approvals/pending
// Returns all pending approval gates across all runs
// ────────────────────────────────────────────────────────────
approvalsRouter.get('/pending', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('approvals')
      .select('*, workflow_runs(workflow_id), workflow_run_steps(name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/approvals/:id/decision
// Body: { decision: 'approved'|'rejected', approved_by, comments }
// Updates the approval and notifies the Orchestrator to resume/abort
// ────────────────────────────────────────────────────────────
approvalsRouter.post('/:id/decision', async (req, res) => {
  try {
    const approvalId = req.params.id;
    const { decision, approved_by, comments } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    }

    // Update approval row
    const { data: approval, error: approvalErr } = await supabase
      .from('approvals')
      .update({
        status: decision,
        approved_by: decision === 'approved' ? approved_by : null,
        comments,
        decided_at: new Date().toISOString(),
      })
      .eq('id', approvalId)
      .select()
      .single();

    if (approvalErr) throw new Error(approvalErr.message);

    // Notify Python Orchestrator to resume or abort the run
    const baseUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';
    await axios.post(`${baseUrl}/approval-callback`, {
      run_id: approval.run_id,
      node_id: approval.node_id,
      decision,
    });

    return res.json(approval);
  } catch (err) {
    console.error('[POST /approvals/:id/decision]', err.message);
    return res.status(500).json({ error: err.message });
  }
});
```

---

## File: backend/src/routes/logs.js

```js
// backend/src/routes/logs.js
import express from 'express';
import { supabase } from '../supabaseClient.js';

export const logsRouter = express.Router();

// ────────────────────────────────────────────────────────────
// GET /api/logs/run/:run_id
// Returns all logs for a given run, in chronological order
// ────────────────────────────────────────────────────────────
logsRouter.get('/run/:run_id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('run_logs')
      .select('*')
      .eq('run_id', req.params.run_id)
      .order('timestamp', { ascending: true });

    if (error) throw new Error(error.message);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
```

---

## File: backend/package.json

```json
{
  "name": "agentic-mcp-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.js",
    "start": "node src/server.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "axios": "^1.6.0",
    "body-parser": "^1.20.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.18.0",
    "morgan": "^1.10.0"
  }
}
```

---

## Endpoints Summary

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workflows/plan` | NL description → DAG plan (Planner Agent) |
| `POST` | `/api/workflows` | Save a DAG as a workflow |
| `GET` | `/api/workflows/:id` | Fetch a workflow and its DAG |
| `GET` | `/api/workflows/:id/runs` | List all runs for a workflow |
| `POST` | `/api/workflows/:id/execute` | Start a workflow run |
| `GET` | `/api/approvals/pending` | List pending approval gates |
| `POST` | `/api/approvals/:id/decision` | Approve or reject an approval gate |
| `GET` | `/api/logs/run/:run_id` | Fetch all logs for a run |
| `GET` | `/health` | Health check |

