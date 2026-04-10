# Database Schema — Supabase (Postgres)

Run these SQL statements in the Supabase SQL Editor to set up all tables.

---

## Tables

### 1. connectors

Stores configuration for each MCP server connection.

```sql
create table connectors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null,          -- 'jira' | 'slack' | 'sheets' | 'github'
  mcp_server_url text not null,
  tool_whitelist text[] default '{}', -- only these tools can be called
  config      jsonb not null default '{}',
  created_by  uuid references auth.users(id),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table connectors enable row level security;
create policy "Admins manage connectors"
  on connectors for all
  using (auth.uid() in (select id from profiles where role = 'admin'));
create policy "All authenticated users read connectors"
  on connectors for select
  using (auth.role() = 'authenticated');
```

---

### 2. workflows

```sql
create table workflows (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users(id),
  name        text not null,
  description text,
  dag_json    jsonb not null,         -- full DAG: nodes, edges, approval gates
  version     int not null default 1,
  is_active   boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table workflows enable row level security;
create policy "Owner can manage workflow"
  on workflows for all
  using (owner_id = auth.uid());
create policy "Admin can manage all workflows"
  on workflows for all
  using (auth.uid() in (select id from profiles where role in ('admin','devops')));
```

---

### 3. workflow_runs

```sql
create table workflow_runs (
  id             uuid primary key default gen_random_uuid(),
  workflow_id    uuid references workflows(id),
  version        int not null,
  status         text not null default 'queued',
                 -- 'queued' | 'running' | 'paused' | 'success' | 'failed'
  mode           text not null default 'live',  -- 'live' | 'dry-run'
  started_by     uuid references auth.users(id),
  input_context  jsonb default '{}',
  result_summary jsonb default '{}',
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz default now()
);

alter table workflow_runs enable row level security;
create policy "Owner / admin can manage runs"
  on workflow_runs for all
  using (
    started_by = auth.uid()
    or auth.uid() in (select id from profiles where role in ('admin','devops'))
  );
```

---

### 4. workflow_run_steps

Tracks individual DAG node executions.

```sql
create table workflow_run_steps (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references workflow_runs(id),
  node_id      text not null,
  name         text not null,
  type         text not null,    -- 'mcp_tool' | 'approval_gate'
  status       text not null default 'pending',
               -- 'pending' | 'running' | 'waiting_approval' | 'success' | 'failed' | 'skipped'
  attempt      int not null default 0,
  max_attempts int not null default 3,
  input_json   jsonb default '{}',
  output_json  jsonb default '{}',
  error_json   jsonb default '{}',
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz default now()
);

alter table workflow_run_steps enable row level security;
create policy "Anyone in run's team can read steps"
  on workflow_run_steps for select
  using (
    run_id in (
      select id from workflow_runs where started_by = auth.uid()
    )
  );
```

---

### 5. approvals

```sql
create table approvals (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references workflow_runs(id),
  run_step_id   uuid references workflow_run_steps(id),
  node_id       text not null,
  status        text not null default 'pending',
                -- 'pending' | 'approved' | 'rejected'
  requested_by  uuid references auth.users(id),
  approved_by   uuid references auth.users(id),
  comments      text,
  decided_at    timestamptz,
  created_at    timestamptz default now()
);

alter table approvals enable row level security;
create policy "On-call / admin can decide approvals"
  on approvals for update
  using (auth.uid() in (select id from profiles where role in ('admin','devops','oncall')));
create policy "Authenticated users can read approvals"
  on approvals for select
  using (auth.role() = 'authenticated');
```

---

### 6. run_logs

Append-only execution log for full audit trail.

```sql
create table run_logs (
  id          bigserial primary key,
  run_id      uuid references workflow_runs(id),
  step_id     uuid references workflow_run_steps(id),
  level       text not null default 'info',  -- 'info' | 'warning' | 'error'
  message     text not null,
  payload     jsonb default '{}',
  timestamp   timestamptz default now()
);

alter table run_logs enable row level security;
create policy "Run owner can read logs"
  on run_logs for select
  using (
    run_id in (select id from workflow_runs where started_by = auth.uid())
    or auth.uid() in (select id from profiles where role = 'admin')
  );
-- Logs are insert-only; no update/delete for integrity
```

---

### 7. workflow_templates

Reusable workflows created from successful runs or manually authored.

```sql
create table workflow_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  dag_json    jsonb not null,
  tags        text[] default '{}',
  created_by  uuid references auth.users(id),
  is_public   boolean default false,
  created_at  timestamptz default now()
);

alter table workflow_templates enable row level security;
create policy "Public templates visible to all"
  on workflow_templates for select
  using (is_public = true or created_by = auth.uid());
```

---

### 8. workflow_suggestions

Stores Learning Agent output and AI-generated improvement suggestions.

```sql
create table workflow_suggestions (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid references workflows(id),
  owner_id        uuid references auth.users(id),
  workflow_name   text,
  description     text,
  dag_json        jsonb default '[]',
  suggestions     text[] default '{}',
  suggestion_type text default 'improvement',
                  -- 'improvement' | 'template' | 'parameter_tuning'
  created_at      timestamptz default now()
);
```

---

### 9. profiles

Role management for RBAC.

```sql
create table profiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  role    text not null default 'viewer',
          -- 'admin' | 'devops' | 'oncall' | 'viewer'
  display_name text,
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, role)
  values (new.id, 'viewer');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
```

