/**
 * lesson-feedback-speech — PRODUCTION
 * Same TTS stack as api/speech.ts (xAI → Alibaba DashScope)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function env(...keys: string[]): string {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function buildScript(input: { correct: boolean; expectedAnswer?: string }): string {
  if (input.correct) return "Alright, correct. Well done — let's continue.";
  const ans = (input.expectedAnswer || "the answer we just covered").trim();
  return `Not quite. The right answer is ${ans}. Let's continue.`;
}

function mapToAlibabaVoice(rawVoice?: string): string {
  if (!rawVoice) return "Jennifer";
  const lower = rawVoice.toLowerCase().trim();
  if (lower.includes("altair") || lower.includes("male") || lower.includes("stanley")) {
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

async function ttsShort(text: string, voice: string): Promise<{ audioBase64: string; mimeType: string }> {
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
          text,
          voice_id: voice || "altair",
          language: "en",
          with_timestamps: false,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.audio) {
          return { audioBase64: payload.audio, mimeType: payload.content_type || "audio/mpeg" };
        }
      }
    } catch (_) {}
  }

  const alibabaKey = env("ALIBABA_API_KEY", "VITE_ALIBABA_API_KEY");
  if (!alibabaKey) throw new Error("TTS unavailable: set XAI_API_KEY or ALIBABA_API_KEY");

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
        input: { text, voice: mapToAlibabaVoice(voice), language_type: "English" },
      }),
    },
  );
  if (!dashRes.ok) throw new Error(`Alibaba TTS ${dashRes.status}`);
  const dsData = await dashRes.json();
  const audioUrl = dsData?.output?.audio?.url || dsData?.output?.audio || "";
  if (!audioUrl) throw new Error("No audio URL");
  const audioRes = await fetch(audioUrl);
  const bytes = new Uint8Array(await audioRes.arrayBuffer());
  return { audioBase64: bytesToBase64(bytes), mimeType: "audio/mpeg" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const anonKey = env("SUPABASE_ANON_KEY");
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const correct = Boolean(body.correct);
    const expectedAnswer = body.expectedAnswer ? String(body.expectedAnswer) : undefined;
    const voice = String(body.voice || "Altair");
    const script = buildScript({ correct, expectedAnswer });

    try {
      const { audioBase64, mimeType } = await ttsShort(script, voice);
      return json({ text: script, audio: audioBase64, mimeType, durationHintSec: 3 });
    } catch (ttsErr: any) {
      return json({
        text: script,
        fallbackTextOnly: true,
        error: String(ttsErr?.message || ttsErr),
      });
    }
  } catch (e: any) {
    return json({ error: String(e?.message || e), fallbackTextOnly: true }, 200);
  }
});
