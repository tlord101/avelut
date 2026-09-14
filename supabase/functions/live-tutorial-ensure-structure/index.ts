/**
 * live-tutorial-ensure-structure
 * Short edge function: Checks or generates topic teaching structure only.
 * Saves structure in DB (topic_teaching_structures) and returns it instantly.
 * Does NOT generate board contents or TTS audio.
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

function topicKeyFromTitle(title: string): string {
  return String(title || "topic")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "topic";
}

function boardsForDuration(mode: number): number {
  if (mode === 15) return 8;
  if (mode === 30) return 15;
  if (mode === 60) return 30;
  return 8;
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
    const syllabusContext = body.syllabusContext ? String(body.syllabusContext) : null;
    const durationMinutes = Number(body.durationMinutes || body.durationMode || 30);

    if (!topicTitle || ![15, 30, 60].includes(durationMinutes)) {
      return json({ error: "Invalid payload: topicTitle + durationMinutes (15|30|60) required" }, 400);
    }

    const topicKey = topicKeyFromTitle(topicTitle);
    const boardCount = boardsForDuration(durationMinutes);
    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Check topic_teaching_structures table
    const { data: existing, error: selectErr } = await admin
      .from("topic_teaching_structures")
      .select("*")
      .eq("topic_key", topicKey)
      .eq("duration_minutes", durationMinutes)
      .eq("course_name", courseName || "")
      .maybeSingle();

    if (!selectErr && existing?.structure_json) {
      return json({
        structureId: existing.id,
        topicKey: existing.topic_key,
        topicTitle: existing.topic_title,
        courseName: existing.course_name,
        durationMinutes: existing.duration_minutes,
        structure: existing.structure_json,
        boardCount: existing.board_count,
        cached: true,
      });
    }

    // 2. Generate structure using Gemini / OpenRouter API
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("OPENROUTER_API_KEY");
    let structureJson: any = null;

    if (geminiKey) {
      const prompt = `You are a world-class university lecturer creating a structured whiteboard lecture plan.
Topic: "${topicTitle}"
Course: "${courseName || 'General Academic'}"
Duration: ${durationMinutes} minutes (${boardCount} whiteboard boards).
Context: "${syllabusContext || 'Standard University Curriculum'}"

Generate a TeachingStructure with exactly ${boardCount} board titles in sequential pedagogical order:
Return STRICTLY valid JSON with no markdown block ticks:
{
  "topic": "${topicTitle}",
  "duration_minutes": ${durationMinutes},
  "overallSummary": "Clear 2-sentence summary of what students will master.",
  "boards": [
    {
      "board_number": 1,
      "title": "Board title describing this sub-concept",
      "concept": "Core mathematical or conceptual focus"
    }
  ]
}`;

      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" },
            }),
          }
        );
        if (resp.ok) {
          const resData = await resp.json();
          const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || "";
          structureJson = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, "").trim());
        }
      } catch (err) {
        console.warn("[ensure-structure] AI call failed, falling back to default structure:", err);
      }
    }

    // Fallback structure if AI key missing or API fails
    if (!structureJson || !Array.isArray(structureJson.boards)) {
      structureJson = {
        topic: topicTitle,
        duration_minutes: durationMinutes,
        overallSummary: `Comprehensive ${durationMinutes}-minute breakdown of ${topicTitle}.`,
        boards: Array.from({ length: boardCount }, (_, i) => ({
          board_number: i + 1,
          title: `${topicTitle} — Part ${i + 1}`,
          concept: `Key principles and applications of ${topicTitle}`,
        })),
      };
    }

    // 3. Save row to topic_teaching_structures
    const { data: inserted, error: insertErr } = await admin
      .from("topic_teaching_structures")
      .upsert(
        {
          topic_key: topicKey,
          topic_title: topicTitle,
          course_name: courseName || "",
          duration_minutes: durationMinutes,
          structure_json: structureJson,
          board_count: boardCount,
        },
        { onConflict: "topic_key,duration_minutes,course_name" }
      )
      .select("*")
      .single();

    if (insertErr) {
      console.warn("[ensure-structure] Insert error:", insertErr);
    }

    return json({
      structureId: inserted?.id || null,
      topicKey,
      topicTitle,
      courseName,
      durationMinutes,
      structure: structureJson,
      boardCount,
      cached: false,
    });
  } catch (e: any) {
    console.error("[live-tutorial-ensure-structure]", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
