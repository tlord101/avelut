/**
 * Database Migration Runner Service — One-click safe schema migrations for Admin.
 *
 * Maintains `public.schema_migrations` table in Supabase.
 * Executes ordered SQL migrations safely with dry-run support, idempotency, and detailed logs.
 */

import { supabase } from '../lib/supabaseClient';

export interface MigrationFile {
  id: string;
  title: string;
  sql: string;
}

export interface AppliedMigration {
  id: string;
  applied_at: string;
  checksum?: string;
  success: boolean;
  details?: string;
}

export interface MigrationRunResult {
  success: boolean;
  appliedCount: number;
  skippedCount: number;
  failedMigrationId?: string;
  logs: string[];
}

// ── Curated Ordered Registry of Schema Migrations ──────────────────────────
export const EMBEDDED_MIGRATIONS: MigrationFile[] = [
  {
    id: '20260830000001_initial_avelut_schema.sql',
    title: 'Initial Avelut Core Schema',
    sql: `
      CREATE TABLE IF NOT EXISTS public.profiles (
        id text PRIMARY KEY,
        email text,
        display_name text,
        photo_url text,
        role text DEFAULT 'user',
        is_admin boolean DEFAULT false,
        subscription_status text DEFAULT 'free',
        ai_credits int DEFAULT 50,
        xp int DEFAULT 0,
        status text DEFAULT 'active',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Profiles read own or public" ON public.profiles;
      CREATE POLICY "Profiles read own or public" ON public.profiles FOR SELECT USING (true);
      DROP POLICY IF EXISTS "Profiles update own" ON public.profiles;
      CREATE POLICY "Profiles update own" ON public.profiles FOR UPDATE USING (auth.uid()::text = id);
    `,
  },
  {
    id: '20260905_messenger_notifications.sql',
    title: 'Messenger & Notifications Tables',
    sql: `
      CREATE TABLE IF NOT EXISTS public.notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        title text NOT NULL,
        message text NOT NULL,
        type text DEFAULT 'general_info',
        route text DEFAULT 'dashboard',
        is_read boolean DEFAULT false,
        created_at timestamptz DEFAULT now()
      );
      ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS notifications_own ON public.notifications;
      CREATE POLICY notifications_own ON public.notifications FOR ALL USING (auth.uid()::text = user_id);
    `,
  },
  {
    id: '20260906_create_app_kv.sql',
    title: 'App Key-Value Settings Storage',
    sql: `
      CREATE TABLE IF NOT EXISTS public.app_kv (
        key text PRIMARY KEY,
        value jsonb,
        updated_at timestamptz DEFAULT now()
      );
      ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Allow public read on app_kv" ON public.app_kv;
      CREATE POLICY "Allow public read on app_kv" ON public.app_kv FOR SELECT USING (true);
      DROP POLICY IF EXISTS "Allow authenticated insert/update on app_kv" ON public.app_kv;
      CREATE POLICY "Allow authenticated insert/update on app_kv" ON public.app_kv FOR ALL TO authenticated USING (true) WITH CHECK (true);
    `,
  },
  {
    id: '20260908_create_topic_teaching_structures_and_views.sql',
    title: 'Topic Teaching Structures Cache',
    sql: `
      CREATE TABLE IF NOT EXISTS public.topic_teaching_structures (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        topic_key text NOT NULL,
        topic_title text NOT NULL,
        course_name text,
        duration_minutes int NOT NULL CHECK (duration_minutes IN (15, 30, 60)),
        content_hash text,
        structure_json jsonb NOT NULL,
        board_count int NOT NULL,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      ALTER TABLE public.topic_teaching_structures ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS topic_teaching_structures_read_authenticated ON public.topic_teaching_structures;
      CREATE POLICY topic_teaching_structures_read_authenticated ON public.topic_teaching_structures FOR SELECT TO authenticated USING (true);
    `,
  },
  {
    id: '20260911_lesson_prep_cloud.sql',
    title: 'Cloud Lesson Prep Jobs & Packages',
    sql: `
      CREATE TABLE IF NOT EXISTS public.lesson_prep_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        prep_key text NOT NULL UNIQUE,
        user_id text NOT NULL,
        topic_title text NOT NULL,
        course_name text,
        duration_mode smallint NOT NULL CHECK (duration_mode IN (15, 30, 60)),
        voice text NOT NULL DEFAULT 'Altair',
        status text NOT NULL DEFAULT 'queued',
        phase text NOT NULL DEFAULT 'queued',
        total_boards int NOT NULL DEFAULT 0,
        next_board_index int NOT NULL DEFAULT 0,
        completed_boards int NOT NULL DEFAULT 0,
        progress_percent int NOT NULL DEFAULT 0,
        message text,
        last_error text,
        charged boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.lesson_prep_jobs ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS lesson_prep_jobs_select_own ON public.lesson_prep_jobs;
      CREATE POLICY lesson_prep_jobs_select_own ON public.lesson_prep_jobs FOR SELECT USING (auth.uid()::text = user_id);
    `,
  },
  {
    id: '20260912_live_tutorial_redesign.sql',
    title: 'Live Minute Pools & Quota RPCs',
    sql: `
      CREATE TABLE IF NOT EXISTS public.live_minute_pools (
        user_id text NOT NULL,
        period_key text NOT NULL,
        used_minutes int NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now(),
        PRIMARY KEY (user_id, period_key)
      );
      ALTER TABLE public.live_minute_pools ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS live_minute_pools_own ON public.live_minute_pools;
      CREATE POLICY live_minute_pools_own ON public.live_minute_pools FOR ALL USING (auth.uid()::text = user_id);
    `,
  },
  {
    id: '20260913_playground_tables.sql',
    title: 'Playground Past Questions & Flashcards',
    sql: `
      CREATE TABLE IF NOT EXISTS public.past_question_packs (
        id text PRIMARY KEY,
        title text NOT NULL,
        course_code text,
        course_name text,
        year text,
        type text DEFAULT 'mixed',
        question_count int DEFAULT 0,
        questions jsonb NOT NULL DEFAULT '[]'::jsonb,
        published boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      ALTER TABLE public.past_question_packs ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS past_question_packs_read ON public.past_question_packs;
      CREATE POLICY past_question_packs_read ON public.past_question_packs FOR SELECT USING (true);
    `,
  },
];

export async function ensureMigrationTable(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('exec_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          id text PRIMARY KEY,
          applied_at timestamptz DEFAULT now(),
          checksum text,
          success boolean DEFAULT true,
          details text
        );
        ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "schema_migrations_read" ON public.schema_migrations;
        CREATE POLICY "schema_migrations_read" ON public.schema_migrations FOR SELECT USING (true);
      `,
    });

    if (error) {
      const { error: selectErr } = await supabase.from('schema_migrations').select('id').limit(1);
      if (selectErr && selectErr.code === '42P01') {
        console.warn('[MigrationRunner] schema_migrations table does not exist.');
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('[MigrationRunner] ensureMigrationTable exception:', e);
    return false;
  }
}

export async function getMigrationStatus(): Promise<{
  applied: AppliedMigration[];
  pending: MigrationFile[];
}> {
  await ensureMigrationTable();

  let applied: AppliedMigration[] = [];
  try {
    const { data } = await supabase.from('schema_migrations').select('*');
    if (Array.isArray(data)) {
      applied = data as AppliedMigration[];
    }
  } catch (e) {
    console.warn('[MigrationRunner] Failed to select schema_migrations:', e);
  }

  const appliedIds = new Set(applied.filter((a) => a.success).map((a) => a.id));
  const pending = EMBEDDED_MIGRATIONS.filter((m) => !appliedIds.has(m.id));

  return { applied, pending };
}

export async function executeMigrations(options?: {
  dryRun?: boolean;
}): Promise<MigrationRunResult> {
  const isDryRun = !!options?.dryRun;
  const logs: string[] = [];
  logs.push(`[${new Date().toLocaleTimeString()}] Starting schema migration runner (${isDryRun ? 'DRY RUN' : 'EXECUTE MODE'})...`);

  const { applied, pending } = await getMigrationStatus();
  logs.push(`Found ${applied.length} applied migrations, ${pending.length} pending migrations.`);

  if (pending.length === 0) {
    logs.push('Database schema is already fully up to date! Nothing to apply.');
    return {
      success: true,
      appliedCount: 0,
      skippedCount: EMBEDDED_MIGRATIONS.length,
      logs,
    };
  }

  let appliedCount = 0;

  for (const m of pending) {
    logs.push(`\n---> [${m.id}] ${m.title}`);

    if (isDryRun) {
      logs.push(`  [DRY RUN] Would execute ${m.sql.trim().length} bytes of SQL.`);
      appliedCount++;
      continue;
    }

    try {
      const { error: rpcErr } = await supabase.rpc('exec_sql', { query: m.sql });

      if (rpcErr) {
        throw new Error(`RPC exec_sql failed: ${rpcErr.message}`);
      }

      await supabase.from('schema_migrations').upsert({
        id: m.id,
        applied_at: new Date().toISOString(),
        success: true,
        details: `Applied ${m.title} (${m.sql.trim().length} bytes)`,
      });

      logs.push(`  [SUCCESS] Applied ${m.id}`);
      appliedCount++;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      logs.push(`  [ERROR] Failed to apply ${m.id}: ${errMsg}`);

      await supabase.from('schema_migrations').upsert({
        id: m.id,
        applied_at: new Date().toISOString(),
        success: false,
        details: `Error: ${errMsg}`,
      });

      return {
        success: false,
        appliedCount,
        skippedCount: pending.length - appliedCount,
        failedMigrationId: m.id,
        logs,
      };
    }
  }

  logs.push(`\n[${new Date().toLocaleTimeString()}] Migration completed successfully! ${appliedCount} migration(s) processed.`);

  return {
    success: true,
    appliedCount,
    skippedCount: EMBEDDED_MIGRATIONS.length - appliedCount,
    logs,
  };
}
