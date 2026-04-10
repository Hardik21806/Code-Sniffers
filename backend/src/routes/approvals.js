// backend/src/routes/approvals.js
import express from 'express';
import { supabase } from '../supabaseClient.js';
import axios from 'axios';

export const approvalsRouter = express.Router();

async function notifyOrchestrator(run_id, node_id, decision) {
  try {
    const baseUrl = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';
    await axios.post(`${baseUrl}/approval-callback`, {
      run_id,
      node_id,
      decision,
    });
  } catch (err) {
    console.error('[WARN] Could not notify orchestrator:', err.message);
  }
}

// GET /api/approvals/pending
// No joins — simple select on approvals table only
approvalsRouter.get('/pending', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('approvals')
      .select('*')          // ← no join, no FK needed
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (err) {
    console.error('[ERROR] GET /approvals/pending:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/approvals/:id/decision
// Body: { decision: 'approved' | 'rejected', comments }
approvalsRouter.post('/:id/decision', async (req, res) => {
  try {
    const id = req.params.id;
    const { decision, comments } = req.body;

    // Fetch approval row first
    const { data: approval, error: fetchErr } = await supabase
      .from('approvals')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr) throw fetchErr;

    // Update approval status
    const { data: updated, error: updateErr } = await supabase
      .from('approvals')
      .update({
        status:     decision === 'approved' ? 'approved' : 'rejected',
        comments:   comments || '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Notify Python orchestrator
    await notifyOrchestrator(approval.run_id, approval.node_id, decision);

    return res.json(updated);
  } catch (err) {
    console.error('[ERROR] POST /approvals/:id/decision:', err.message);
    return res.status(500).json({ error: err.message });
  }
});