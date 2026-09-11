/**
 * lesson-prep-enqueue
 * Authenticated users enqueue (or reuse) a cloud lesson prep job.
 * Deploy: supabase functions deploy lesson-prep-enqueue
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function boardsForDuration(mode: number): number {
  if (mode === 15) return 8;
  if (mode === 30) return 15;
  if (mode === 60) return 30;
  return 8;
}

function topicKeyFromTitle(title: string): string {
  return String(title || "topic")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "topic";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const topicTitle = String(body.topicTitle || "").trim();
    const courseName = body.courseName ? String(body.courseName) : null;
    const syllabusContext = body.syllabusContext
      ? String(body.syllabusContext)
      : null;
    const durationMode = Number(body.durationMode);
    const voice = String(body.voice || "Altair");
    const contentHash = body.contentHash ? String(body.contentHash) : null;

    if (!topicTitle || ![15, 30, 60].includes(durationMode)) {
      return json({ error: "Invalid payload: topicTitle + durationMode (15|30|60) required" }, 400);
    }

    const topicKey = topicKeyFromTitle(topicTitle);
    const prepKey = `${user.id}::${topicKey}::${durationMode}`;
    const totalBoards = boardsForDuration(durationMode);
    const storagePrefix = `${user.id}/${prepKey}`;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existing, error: existErr } = await admin
      .from("lesson_prep_jobs")
      .select("*")
      .eq("prep_key", prepKey)
      .maybeSingle();

    if (existErr) throw existErr;

    if (existing?.status === "ready") {
      return json({ job: existing, reused: true, reason: "already_ready" });
    }

    if (existing && ["queued", "running", "uploading"].includes(existing.status)) {
      return json({ job: existing, reused: true, reason: "in_progress" });
    }

    if (existing?.status === "failed") {
      const { data: job, error } = await admin
        .from("lesson_prep_jobs")
        .update({
          status: "queued",
          phase: "queued",
          message: "Re-queued after failure. Resume from last checkpoint.",
          last_error: null,
          locked_at: null,
          locked_by: null,
          voice,
          syllabus_context: syllabusContext,
          content_hash: contentHash,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;

      kickWorker(supabaseUrl, serviceKey);
      return json({ job, reused: true, reason: "requeued_failed" });
    }

    const row = {
      prep_key: prepKey,
      user_id: user.id,
      topic_title: topicTitle,
      course_name: courseName,
      syllabus_context: syllabusContext,
      duration_mode: durationMode,
      voice,
      content_hash: contentHash,
      status: "queued",
      phase: "queued",
      total_boards: totalBoards,
      next_board_index: 0,
      completed_boards: 0,
      progress_percent: 0,
      message: "Queued for cloud preparation",
      storage_prefix: storagePrefix,
      attempt_count: 0,
      max_attempts: 5,
      priority: 100,
    };

    const { data: job, error } = await admin
      .from("lesson_prep_jobs")
      .upsert(row, { onConflict: "prep_key" })
      .select("*")
      .single();

    if (error) throw error;

    kickWorker(supabaseUrl, serviceKey);
    return json({ job, reused: false });
  } catch (e: any) {
    console.error("[lesson-prep-enqueue]", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});

function kickWorker(supabaseUrl: string, serviceKey: string) {
  const workerUrl = `${supabaseUrl}/functions/v1/lesson-prep-worker`;
  fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ kick: true }),
  }).catch((err) => console.warn("[enqueue] worker kick failed", err));
}
