/**
 * lesson-feedback-speech
 * Short 2–4s spoken feedback for mid-lecture micro-checks.
 * Deploy: supabase functions deploy lesson-feedback-speech
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

function buildScript(input: {
  correct: boolean;
  expectedAnswer?: string;
  userChoice?: string;
}): string {
  if (input.correct) {
    return "Alright, correct. Well done — let's continue.";
  }
  const ans = (input.expectedAnswer || "the answer we just covered").trim();
  return `Not quite. The right answer is ${ans}. Let's continue.`;
}

/**
 * TODO: Port to your real TTS (api/speech.ts / alibaba-speech).
 * Return base64 audio + mimeType.
 */
async function ttsShort(
  text: string,
  voice: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const speechUrl = Deno.env.get("SPEECH_API_URL");
  const serviceKey = Deno.env.get("INTERNAL_API_KEY") || "";

  if (speechUrl) {
    const res = await fetch(speechUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {}),
      },
      body: JSON.stringify({ text, voice, short: true }),
    });
    if (!res.ok) {
      throw new Error(`Speech API ${res.status}`);
    }
    const data = await res.json();
    if (data.audio || data.audioBase64) {
      return {
        audioBase64: data.audio || data.audioBase64,
        mimeType: data.mimeType || "audio/mpeg",
      };
    }
  }

  throw new Error(
    "TTS not configured — set SPEECH_API_URL or implement synthesizeSpeech in this function",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const correct = Boolean(body.correct);
    const expectedAnswer = body.expectedAnswer
      ? String(body.expectedAnswer)
      : undefined;
    const userChoice = body.userChoice ? String(body.userChoice) : undefined;
    const voice = String(body.voice || "Altair");

    const script = buildScript({ correct, expectedAnswer, userChoice });
    const { audioBase64, mimeType } = await ttsShort(script, voice);

    return json({
      text: script,
      audio: audioBase64,
      mimeType,
      durationHintSec: 3,
    });
  } catch (e: any) {
    return json(
      {
        error: String(e?.message || e),
        text: buildScript({
          correct: false,
          expectedAnswer: "the answer on the board",
        }),
        fallbackTextOnly: true,
      },
      200,
    );
  }
});
