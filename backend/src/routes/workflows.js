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
