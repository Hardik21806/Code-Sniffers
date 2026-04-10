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
