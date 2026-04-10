// backend/src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase env vars.\n' +
    'Make sure backend/.env exists with:\n' +
    '  SUPABASE_URL=https://your-project.supabase.co\n' +
    '  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n' +
    'And that you are running: npm run dev (not node src/server.js directly)'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);