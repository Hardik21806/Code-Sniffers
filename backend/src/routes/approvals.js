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
