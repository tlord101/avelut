export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-DashScope-WorkSpace, HTTP-Referer, X-Title',
    },
  });
}

const DASHSCOPE_BASE_URLS = [
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
];

export const DEFAULT_MODEL = 'qwen3.8-omni-flash';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const alibabaApiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';

    if (!alibabaApiKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required ALIBABA_API_KEY for Alibaba DashScope endpoint.' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const workspaceId =
      req.headers.get('x-dashscope-workspace') ||
      process.env.ALIBABA_WORKSPACE_ID ||
      process.env.VITE_ALIBABA_WORKSPACE_ID ||
      'ws-o3v6mh0i8y9tqdfx';

    // Normalize messages and detect vision requests
    const messages = body.messages || [];
    const hasImage = messages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
    );

    let rawModel = (body.model ? String(body.model).trim() : '');
    rawModel = rawModel
      .replace(/^qwen\//i, '')
      .replace(/^alibaba\//i, '')
      .replace(/^google\//i, '')
      .replace(/^openai\//i, '')
      .replace(/^anthropic\//i, '')
      .replace(/^meta-llama\//i, '');

    // Alibaba DashScope strictly hosts native Qwen models.
    // Strictly use Qwen3.8-Omni-Flash everywhere as the default text & multimodal model.
    const isQwenModel = rawModel.toLowerCase().startsWith('qwen');
    const primaryDashscopeModel = isQwenModel ? rawModel : DEFAULT_MODEL;

    const candidateModels = Array.from(new Set([
      primaryDashscopeModel,
      DEFAULT_MODEL,
      'qwen3.7-flash',
    ]));

    // Attempt DashScope / Model Studio MaaS endpoints
    let lastUpstreamError = '';
    let lastUpstreamStatus = 502;
    let attemptedModel = primaryDashscopeModel;

    if (alibabaApiKey) {
      const maasBaseUrl = `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`;
      const customEnvUrl = process.env.ALIBABA_OPENAI_COMPATIBLE_URL || process.env.VITE_ALIBABA_OPENAI_COMPATIBLE_URL;
      const targetBases = Array.from(new Set([
        ...(customEnvUrl ? [customEnvUrl] : []),
        maasBaseUrl,
        'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      ]));

      modelLoop: for (const currentModel of candidateModels) {
        attemptedModel = currentModel;
        for (const baseUrl of targetBases) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);

            const payload: any = {
              model: currentModel,
              messages,
              modalities: ['text'],
              temperature: body.temperature ?? 0.35,
              max_tokens: Math.min(body.max_tokens ?? 2500, 4096),
            };
            if (body.response_format && body.response_format.type === 'json_object') {
              payload.response_format = { type: 'json_object' };
              payload.stream = false; // Strictly enforce non-streaming for JSON mode
            } else if (body.stream) {
              payload.stream = true;
              payload.stream_options = { include_usage: true };
            }

            const requestHeaders: Record<string, string> = {
              'Authorization': `Bearer ${alibabaApiKey}`,
              'Content-Type': 'application/json',
            };
            if (workspaceId) {
              requestHeaders['X-DashScope-WorkSpace'] = workspaceId;
            }

            const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (response.ok) {
              if (payload.stream && response.body) {
                return new Response(response.body, {
                  status: 200,
                  headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                  },
                });
              }
              const data = await response.json();
              const extractedText = data?.choices?.[0]?.message?.content || '';
              return new Response(extractedText, {
                status: 200,
                headers: {
                  'Content-Type': 'text/plain',
                  'Access-Control-Allow-Origin': '*',
                },
              });
            } else {
              const errText = await response.text().catch(() => '');
              lastUpstreamError = errText;
              lastUpstreamStatus = response.status;
              console.warn(`[Alibaba Chat Proxy] Upstream ${baseUrl} (${currentModel}) HTTP ${response.status}:`, errText);
              
              // If model does not exist on DashScope, break out of this model and try next candidate (qwen3.7-flash)
              if (response.status === 400 || response.status === 404 || errText.includes('model_not_found') || errText.includes('Model not exist')) {
                continue modelLoop;
              }

              if (response.status === 429) {
                return new Response(
                  JSON.stringify({ error: "RATE_LIMIT", message: "Upstream provider is temporarily overloaded." }),
                  {
                    status: 429,
                    headers: {
                      'Content-Type': 'application/json',
                      'Access-Control-Allow-Origin': '*',
                    },
                  }
                );
              }
            }
          } catch (fetchErr: any) {
            lastUpstreamError = fetchErr?.message || '';
            console.warn(`[Alibaba Chat Proxy] Upstream fetch to ${baseUrl} failed:`, fetchErr?.message);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ error: `Alibaba DashScope (${attemptedModel}) temporarily unavailable: ${lastUpstreamError || 'Connection error'}` }),
      {
        status: lastUpstreamStatus || 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal AI Chat Proxy Error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

