/**
 * lesson-prep-worker — PRODUCTION
 * Same providers/env as Vercel: openrouter-chat, alibaba-chat, speech (xAI + Alibaba TTS)
 *
 * Secrets (mirror Vercel):
 *   OPENROUTER_API_KEY, OPENROUTER_MODEL
 *   ALIBABA_API_KEY, ALIBABA_WORKSPACE_ID, ALIBABA_OPENAI_COMPATIBLE_URL, ALIBABA_DASHSCOPE_URL
 *   XAI_API_KEY or GROK_API_KEY
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENROUTER_FALLBACK_MODELS = [
  "qwen/qwen3.7-flash",
  "qwen/qwen-2.5-72b-instruct",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-r1:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

const ILLUSTRATION_FIRST =
  "BOARD PRIORITY: illustrations first. Text secondary. Return ONLY valid JSON. No markdown fences.";

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

function boardsForDuration(mode: number): number {
  if (mode === 15) return 8;
  if (mode === 30) return 15;
  if (mode === 60) return 30;
  return 15;
}

function env(...keys: string[]): string {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function extractJson(text: string): any {
  const raw = (text || "").trim();
  if (!raw) throw new Error("Empty model response");
  try {
    return JSON.parse(raw);
  } catch {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) return JSON.parse(fence[1].trim());
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("Could not parse JSON from model response");
  }
}

function isValidBoard(perf: any): boolean {
  if (!perf || perf.isFallback === true) return false;
  const hasSpeech = Boolean(perf.speech && String(perf.speech).trim());
  const hasContent = Boolean(
    perf.title ||
      (Array.isArray(perf.board_actions) && perf.board_actions.length > 0) ||
      perf.svg_illustration,
  );
  return hasSpeech && hasContent;
}

async function chatCompletion(
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  const temperature = opts?.temperature ?? 0.7;
  const max_tokens = opts?.max_tokens ?? 8192;
  const openrouterKey = env("OPENROUTER_API_KEY", "VITE_OPENROUTER_API_KEY");
  const primaryModel =
    opts?.model || env("OPENROUTER_MODEL", "VITE_OPENROUTER_MODEL") || "qwen/qwen3.7-flash";

  if (openrouterKey) {
    const models = Array.from(new Set([primaryModel, ...OPENROUTER_FALLBACK_MODELS]));
    let lastErr = "";
    for (const model of models) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openrouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://avelut.xyz",
            "X-Title": "Avelut AI",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens,
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data?.choices?.[0]?.message?.content;
          if (content) return String(content);
          lastErr = "OpenRouter empty content";
        } else {
          lastErr = await res.text();
          if (res.status !== 429 && res.status < 500) break;
        }
      } catch (e: any) {
        lastErr = e?.message || String(e);
      }
    }
    console.warn("[worker] OpenRouter failed, trying Alibaba:", String(lastErr).slice(0, 200));
  }

  const alibabaKey = env("ALIBABA_API_KEY", "VITE_ALIBABA_API_KEY");
  if (!alibabaKey) {
    throw new Error("No LLM keys: set OPENROUTER_API_KEY and/or ALIBABA_API_KEY (same as Vercel)");
  }

  const workspaceId =
    env("ALIBABA_WORKSPACE_ID", "VITE_ALIBABA_WORKSPACE_ID") || "ws-o3v6mh0i8y9tqdfx";
  const baseUrl =
    env("ALIBABA_OPENAI_COMPATIBLE_URL", "VITE_ALIBABA_OPENAI_COMPATIBLE_URL") ||
    "https://ws-o3v6mh0i8y9tqdfx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${alibabaKey}`,
      "Content-Type": "application/json",
      "X-DashScope-WorkSpace": workspaceId,
    },
    body: JSON.stringify({
      model: "qwen3.7-flash",
      messages,
      temperature,
      max_tokens,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Alibaba chat ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Alibaba chat returned empty content");
  return String(content);
}

function mapToAlibabaVoice(rawVoice?: string): string {
  if (!rawVoice) return "Jennifer";
  const lower = rawVoice.toLowerCase().trim();
  if (
    lower.includes("altair") ||
    lower.includes("male") ||
    lower.includes("onyx") ||
    lower.includes("echo") ||
    lower.includes("stanley")
  ) {
    return "Stanley";
  }
  return "Jennifer";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function synthesizeSpeech(
  text: string,
  voice: string,
): Promise<{ bytes: Uint8Array; mimeType: string; meta?: any }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty speech text");

  const xaiKey = env("XAI_API_KEY", "GROK_API_KEY", "VITE_XAI_API_KEY");
  if (xaiKey) {
    try {
      const res = await fetch("https://api.x.ai/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${xaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: trimmed,
          voice_id: voice || "altair",
          language: "en",
          with_timestamps: true,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.audio) {
          return {
            bytes: base64ToBytes(payload.audio),
            mimeType: payload.content_type || "audio/mpeg",
            meta: payload,
          };
        }
      }
    } catch (e) {
      console.warn("[worker] xAI TTS failed, falling back to Alibaba", e);
    }
  }

  const alibabaKey = env("ALIBABA_API_KEY", "VITE_ALIBABA_API_KEY");
  if (!alibabaKey) {
    throw new Error("TTS unavailable: set XAI_API_KEY/GROK_API_KEY or ALIBABA_API_KEY");
  }

  const workspaceId =
    env("ALIBABA_WORKSPACE_ID", "VITE_ALIBABA_WORKSPACE_ID") || "ws-o3v6mh0i8y9tqdfx";
  const baseUrl =
    env("ALIBABA_DASHSCOPE_URL", "VITE_ALIBABA_DASHSCOPE_URL") ||
    "https://ws-o3v6mh0i8y9tqdfx.ap-southeast-1.maas.aliyuncs.com/api/v1";

  const dashRes = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/services/aigc/multimodal-generation/generation`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alibabaKey}`,
        "Content-Type": "application/json",
        "X-DashScope-WorkSpace": workspaceId,
      },
      body: JSON.stringify({
        model: "qwen3-tts-flash",
        input: {
          text: trimmed,
          voice: mapToAlibabaVoice(voice),
          language_type: "English",
        },
      }),
    },
  );

  if (!dashRes.ok) {
    const errBody = await dashRes.text();
    throw new Error(`Alibaba TTS ${dashRes.status}: ${errBody.slice(0, 400)}`);
  }

  const dsData = await dashRes.json();
  const audioUrl = dsData?.output?.audio?.url || dsData?.output?.audio || "";
  if (!audioUrl) throw new Error("Alibaba TTS returned no audio URL");

  const audioBinaryRes = await fetch(audioUrl);
  if (!audioBinaryRes.ok) throw new Error(`Failed to download TTS audio (${audioBinaryRes.status})`);
  const bytes = new Uint8Array(await audioBinaryRes.arrayBuffer());
  const words = trimmed.split(/\s+/);
  const estimatedDuration = Math.max(2, words.length / 2.8);
  return {
    bytes,
    mimeType: "audio/mpeg",
    meta: { duration: estimatedDuration, content_type: "audio/mp3" },
  };
}

function buildStructurePrompt(job: any): string {
  const topic = job.topic_title;
  const durationMode = Number(job.duration_mode) || 30;
  const expectedCount = boardsForDuration(durationMode);
  return `Prepare a pedagogical Teaching Structure for the topic: "${topic}"
${job.course_name ? `Course: ${job.course_name}\n` : ""}${job.syllabus_context ? `Syllabus/Context: ${job.syllabus_context}\n` : ""}
TARGET DURATION: ${durationMode} minutes
MANDATORY: EXACTLY ${expectedCount} boards in "boards" array (board_1 .. board_${expectedCount}).
Every board needs concrete visual_purpose (what is DRAWN).
${ILLUSTRATION_FIRST}
JSON schema:
{
  "topic": "${topic}",
  "teaching_strategy": "...",
  "learning_goal": "...",
  "duration_minutes": ${durationMode},
  "chapters": [],
  "boards": [
    {
      "board_id": "board_1",
      "board_number": 1,
      "title": "...",
      "step_type": "hook",
      "teaching_objective": "...",
      "what_student_should_understand": "...",
      "why_this_board_exists": "...",
      "visual_purpose": "...",
      "recommended_board_content": ["..."],
      "interaction_required": false,
      "question_required": false,
      "question_type": null,
      "estimated_duration_seconds": 120
    }
  ]
}`;
}

function buildBoardPrompt(job: any, structure: any, boardPlan: any): string {
  const durationMode = Number(job.duration_mode) || 30;
  const topic = structure.topic || job.topic_title;
  const n = boardPlan.board_number;
  const total = structure.boards?.length || boardsForDuration(durationMode);
  return `Live university lecturer for Board ${n} of ${total}: "${boardPlan.title}" on "${topic}".
DURATION: ${durationMode}m. SPEECH: 200-280 words (~2 min). Not short snippets.
PLAN:
Title: ${boardPlan.title}
Step: ${boardPlan.step_type}
Objective: ${boardPlan.teaching_objective}
Visual: ${boardPlan.visual_purpose}
Content: ${JSON.stringify(boardPlan.recommended_board_content || [])}
Question required: ${boardPlan.question_required}
Learning goal: ${structure.learning_goal}
${ILLUSTRATION_FIRST}
JSON schema:
{
  "board_id": "${boardPlan.board_id || `board_${n}`}",
  "board_number": ${n},
  "title": ${JSON.stringify(boardPlan.title || "")},
  "speech": "200-280 words...",
  "speech_beats": [{"id":"beat_1","text":"...","purpose":"introduce","mannerism":"attention","pauseAfterMs":1200}],
  "board_actions": [{"id":"title_${n}","type":"write","content":"...","position":{"x":50,"y":8},"metadata":{"fontSize":"3xl","color":"#FFFFFF"},"sync":{"triggerImmediately":true}}],
  "svg_illustration": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 400 200\\"></svg>",
  "question": null
}`;
}

async function generateStructure(job: any): Promise<any> {
  const content = await chatCompletion(
    [
      { role: "system", content: "You are Avelut Teaching Director. Return ONLY valid JSON." },
      { role: "user", content: buildStructurePrompt(job) },
    ],
    { max_tokens: 12000, temperature: 0.6 },
  );
  const structure = extractJson(content);
  const expected = boardsForDuration(Number(job.duration_mode) || 30);
  if (!Array.isArray(structure.boards) || structure.boards.length < Math.min(3, expected)) {
    throw new Error(`Structure has ${structure.boards?.length || 0} boards; expected ~${expected}`);
  }
  structure.boards = structure.boards.map((b: any, i: number) => ({
    ...b,
    board_number: i + 1,
    board_id: b.board_id || `board_${i + 1}`,
  }));
  structure.topic = structure.topic || job.topic_title;
  structure.duration_minutes = Number(job.duration_mode) || structure.duration_minutes || 30;
  return structure;
}

async function generateBoard(job: any, structure: any, boardIndex: number): Promise<any> {
  const plan = structure.boards[boardIndex];
  if (!plan) throw new Error(`No board plan at index ${boardIndex}`);
  const content = await chatCompletion(
    [
      { role: "system", content: "You are Avelut live lecturer. Return ONLY valid JSON for one board." },
      { role: "user", content: buildBoardPrompt(job, structure, plan) },
    ],
    { max_tokens: 6000, temperature: 0.7 },
  );
  const perf = extractJson(content);
  perf.board_number = boardIndex + 1;
  perf.board_id = perf.board_id || `board_${boardIndex + 1}`;

  const combinedActions: any[] = [...(perf.board_actions || [])];
  const existingIds = new Set(combinedActions.map((a) => a.id).filter(Boolean));

  if (Array.isArray(perf.speech_beats)) {
    for (const beat of perf.speech_beats) {
      if (Array.isArray(beat.board_actions)) {
        for (const act of beat.board_actions) {
          if (act && act.type) {
            const actId = act.id || `act_beat_${Math.random().toString(36).slice(2, 8)}`;
            act.id = actId;
            if (!existingIds.has(actId)) {
              existingIds.add(actId);
              combinedActions.push(act);
            }
          }
        }
      }
    }
  }
  perf.board_actions = combinedActions;

  if (!isValidBoard(perf)) throw new Error(`Invalid board performance for board ${boardIndex + 1}`);
  return perf;
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

async function uploadBytes(admin: any, path: string, bytes: Uint8Array, contentType: string) {
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

async function audioExists(admin: any, path: string): Promise<boolean> {
  const { data, error } = await admin.storage.from("lesson-packages").download(path);
  return !error && !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const wid = workerId();
  let jobId: string | null = null;

  try {
    const { data: claimed, error: claimErr } = await admin.rpc("claim_lesson_prep_job", {
      p_worker_id: wid,
    });
    if (claimErr) throw claimErr;

    const job = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!job) return json({ claimed: false, message: "No queued jobs" });

    jobId = job.id;
    const rawPrefix = String(job.storage_prefix || "");
    const prefix = rawPrefix.replace(/^lesson-packages\//, "");
    const voice = job.voice || "Altair";

    await admin.from("lesson_prep_jobs").update({
      phase: "structure",
      message: "1/3 Planning lesson structure…",
      progress_percent: 5,
    }).eq("id", job.id);

    let structure = (await downloadJsonIfExists(admin, `${prefix}/structure.json`)) || null;
    if (!structure?.boards?.length) {
      structure = await generateStructure(job);
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

        if (!(await audioExists(admin, audioPath))) {
          const { bytes, mimeType, meta } = await synthesizeSpeech(String(boardPerf.speech), voice);
          await uploadBytes(admin, audioPath, bytes, mimeType || "audio/mpeg");
          await uploadJson(admin, `${prefix}/audio/board_${padBoard(boardNum)}.json`, {
            audio: bytesToBase64(bytes),
            content_type: mimeType || "audio/mp3",
            duration: meta?.duration,
            audio_timestamps: meta?.audio_timestamps,
          });
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

      manifestBoards.push({
        index: i,
        board_path: boardRel,
        audio_path: audioStoredPath,
        audio_json_path: hasSpeech ? `audio/board_${padBoard(boardNum)}.json` : null,
      });

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

    return json({ claimed: true, prep_key: job.prep_key, status: "ready", total_boards: boardCount });
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
