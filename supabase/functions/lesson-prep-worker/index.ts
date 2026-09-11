/**
 * lesson-prep-worker
 * Claims one queued job, generates structure + boards + TTS, uploads to Storage.
 *
 * Wire generateStructure / generateBoard / synthesizeSpeech to existing
 * OpenRouter / Alibaba / speech APIs (same as teachingEngineService + lessonPrepService).
 *
 * Deploy: supabase functions deploy lesson-prep-worker
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

function workerId() {
  return `worker_${crypto.randomUUID().slice(0, 8)}`;
}

function padBoard(n: number) {
  return String(n).padStart(3, "0");
}

async function uploadJson(admin: any, path: string, obj: unknown) {
  const body = JSON.stringify(obj);
  const { error } = await admin.storage
    .from("lesson-packages")
    .upload(path, new Blob([body], { type: "application/json" }), {
      upsert: true,
      contentType: "application/json",
    });
  if (error) throw new Error(`uploadJson ${path}: ${error.message}`);
}

async function uploadBytes(
  admin: any,
  path: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const { error } = await admin.storage
    .from("lesson-packages")
    .upload(path, bytes, { upsert: true, contentType });
  if (error) throw new Error(`uploadBytes ${path}: ${error.message}`);
}

async function downloadJsonIfExists(admin: any, path: string): Promise<any | null> {
  const { data, error } = await admin.storage.from("lesson-packages").download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

function isValidBoard(perf: any): boolean {
  if (!perf || perf.isFallback === true) return false;
  const hasSpeech = Boolean(perf.speech && String(perf.speech).trim());
  const hasContent = Boolean(
    perf.title ||
      (Array.isArray(perf.board_actions) && perf.board_actions.length > 0),
  );
  return hasSpeech && hasContent;
}

/** TODO: Port from structurePrefetchService / teaching engine structure request */
async function generateStructure(job: any): Promise<any> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") || Deno.env.get("ALIBABA_API_KEY");
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY or ALIBABA_API_KEY");
  }
  throw new Error(
    "generateStructure not implemented — port client structure generation into this worker",
  );
}

/** TODO: Port board performance generation from teachingEngineService */
async function generateBoard(job: any, structure: any, boardIndex: number): Promise<any> {
  throw new Error(
    `generateBoard not implemented for board ${boardIndex + 1}`,
  );
}

/** TODO: Port TTS from api/speech.ts / alibaba-speech */
async function synthesizeSpeech(
  text: string,
  voice: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  throw new Error("synthesizeSpeech not implemented — port server TTS");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const wid = workerId();
  let jobId: string | null = null;

  try {
    const { data: claimed, error: claimErr } = await admin.rpc(
      "claim_lesson_prep_job",
      { p_worker_id: wid },
    );
    if (claimErr) throw claimErr;

    const job = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!job) {
      return json({ claimed: false, message: "No queued jobs" });
    }

    jobId = job.id;
    const prefix = job.storage_prefix as string;
    const voice = job.voice || "Altair";

    await admin.from("lesson_prep_jobs").update({
      phase: "structure",
      message: "1/3 Planning lesson structure…",
      progress_percent: 5,
    }).eq("id", job.id);

    let structure = (await downloadJsonIfExists(admin, `${prefix}/structure.json`)) || null;
    if (!structure?.boards?.length) {
      structure = await generateStructure(job);
      if (!structure?.boards?.length) {
        throw new Error("Structure generation returned no boards");
      }
      await uploadJson(admin, `${prefix}/structure.json`, structure);
    }

    const boardCount = structure.boards.length;
    await admin.from("lesson_prep_jobs").update({
      phase: "boards",
      total_boards: boardCount,
      message: `Structure ready (${boardCount} boards). Writing boards…`,
      progress_percent: 12,
    }).eq("id", job.id);

    const manifestBoards: any[] = [];

    for (let i = Number(job.next_board_index) || 0; i < boardCount; i++) {
      const boardNum = i + 1;
      const boardRel = `boards/board_${padBoard(boardNum)}.json`;
      const audioRel = `audio/board_${padBoard(boardNum)}.mp3`;
      const boardPath = `${prefix}/${boardRel}`;
      const audioPath = `${prefix}/${audioRel}`;

      await admin.from("lesson_prep_jobs").update({
        phase: "boards",
        message: `Writing Board ${boardNum} of ${boardCount}…`,
        progress_percent: Math.min(70, Math.round(12 + (boardNum / boardCount) * 50)),
        next_board_index: i,
      }).eq("id", job.id);

      let boardPerf = (await downloadJsonIfExists(admin, boardPath)) || null;
      if (!isValidBoard(boardPerf)) {
        boardPerf = await generateBoard(job, structure, i);
        if (!isValidBoard(boardPerf)) {
          throw new Error(`Invalid board performance for board ${boardNum}`);
        }
        await uploadJson(admin, boardPath, boardPerf);
      }

      const hasSpeech = Boolean(boardPerf.speech?.trim());
      let audioStoredPath: string | null = null;

      if (hasSpeech) {
        await admin.from("lesson_prep_jobs").update({
          phase: "tts",
          message: `Generating Board ${boardNum} of ${boardCount} speech audio…`,
          progress_percent: Math.min(92, Math.round(62 + (boardNum / boardCount) * 30)),
        }).eq("id", job.id);

        const { data: existingAudio } = await admin.storage
          .from("lesson-packages")
          .download(audioPath);
        if (!existingAudio) {
          const { bytes, mimeType } = await synthesizeSpeech(String(boardPerf.speech), voice);
          await uploadBytes(admin, audioPath, bytes, mimeType || "audio/mpeg");
        }
        audioStoredPath = audioRel;
      }

      await admin.from("lesson_package_boards").upsert({
        prep_key: job.prep_key,
        board_index: i,
        board_number: boardNum,
        board_path: boardRel,
        audio_path: audioStoredPath,
        has_speech: hasSpeech,
        is_valid: true,
      }, { onConflict: "prep_key,board_index" });

      manifestBoards.push({ index: i, board_path: boardRel, audio_path: audioStoredPath });

      await admin.from("lesson_prep_jobs").update({
        next_board_index: i + 1,
        completed_boards: i + 1,
        progress_percent: Math.min(95, Math.round(12 + ((i + 1) / boardCount) * 80)),
      }).eq("id", job.id);
    }

    await admin.from("lesson_prep_jobs").update({
      phase: "upload",
      message: "Finalizing package…",
      progress_percent: 97,
    }).eq("id", job.id);

    const manifest = {
      prep_key: job.prep_key,
      duration_mode: job.duration_mode,
      voice,
      total_boards: boardCount,
      structure_path: "structure.json",
      boards: manifestBoards,
      model_version: job.model_version || "v1",
      ready_at: new Date().toISOString(),
    };
    await uploadJson(admin, `${prefix}/manifest.json`, manifest);

    await admin.from("lesson_prep_jobs").update({
      status: "ready",
      phase: "ready",
      progress_percent: 100,
      message: "Package ready for download",
      structure_path: `${prefix}/structure.json`,
      manifest_path: `${prefix}/manifest.json`,
      ready_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    }).eq("id", job.id);

    await admin.from("lesson_packages").upsert({
      prep_key: job.prep_key,
      user_id: job.user_id,
      topic_title: job.topic_title,
      course_name: job.course_name,
      duration_mode: job.duration_mode,
      voice,
      content_hash: job.content_hash,
      model_version: job.model_version || "v1",
      total_boards: boardCount,
      storage_prefix: prefix,
      structure_path: `${prefix}/structure.json`,
      manifest_path: `${prefix}/manifest.json`,
      status: "ready",
      ready_at: new Date().toISOString(),
    }, { onConflict: "prep_key" });

    return json({
      claimed: true,
      prep_key: job.prep_key,
      status: "ready",
      total_boards: boardCount,
    });
  } catch (e: any) {
    console.error("[lesson-prep-worker]", e);
    if (jobId) {
      await admin.from("lesson_prep_jobs").update({
        status: "failed",
        phase: "failed",
        last_error: String(e?.message || e),
        message: "Preparation paused. Tap Resume preparation to retry.",
        failed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      }).eq("id", jobId);
    }
    return json({ error: String(e?.message || e) }, 500);
  }
});
