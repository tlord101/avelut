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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const alibabaApiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';

    const openRouterApiKey =
      process.env.OPENROUTER_API_KEY ||
      process.env.VITE_OPENROUTER_API_KEY ||
      req.headers.get('x-openrouter-key') ||
      '';

    if (!alibabaApiKey && !openRouterApiKey) {
      return new Response(
        JSON.stringify({ error: 'Missing required API keys (ALIBABA_API_KEY or OPENROUTER_API_KEY).' }),
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

    let rawModel = (body.model ? String(body.model).trim() : 'qwen3.7-flash');
    rawModel = rawModel.replace(/^qwen\//i, '').replace(/^alibaba\//i, '');
    if (!rawModel) rawModel = 'qwen3.7-flash';

    const dashscopeModel = hasImage ? 'qwen-vl-plus' : 'qwen-turbo';
    const openrouterModel = hasImage ? 'qwen/qwen-vl-plus' : 'qwen/qwen3.7-flash';

    // 1. If Alibaba DashScope API key exists, attempt DashScope international / regional endpoints
    if (alibabaApiKey) {
      const customEnvUrl = process.env.ALIBABA_OPENAI_COMPATIBLE_URL || process.env.VITE_ALIBABA_OPENAI_COMPATIBLE_URL;
      const targetBases = customEnvUrl && !customEnvUrl.includes('maas.aliyuncs.com')
        ? [customEnvUrl, ...DASHSCOPE_BASE_URLS]
        : DASHSCOPE_BASE_URLS;

      for (const baseUrl of targetBases) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 18000);

          const payload: any = {
            model: dashscopeModel,
            messages,
            temperature: body.temperature ?? 0.35,
            max_tokens: Math.min(body.max_tokens ?? 2500, 4096),
          };
          if (body.response_format && body.response_format.type === 'json_object') {
            payload.response_format = { type: 'json_object' };
            payload.stream = false; // Strictly enforce non-streaming for JSON mode
          } else if (body.stream) {
            payload.stream = true;
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
          } else if (response.status === 429) {
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
        } catch {
          // Continue to next endpoint or OpenRouter fallback
        }
      }
    }

    // 2. Resilient Fallback to OpenRouter (guarantees fast 2-3s response with Qwen)
    if (openRouterApiKey) {
      try {
        const openRouterPayload: any = {
          model: openrouterModel,
          messages,
          temperature: body.temperature ?? 0.35,
          max_tokens: Math.min(body.max_tokens ?? 2500, 4096),
          include_reasoning: false,
        };
        if (body.response_format && body.response_format.type === 'json_object') {
          openRouterPayload.response_format = { type: 'json_object' };
          openRouterPayload.stream = false; // Strictly enforce non-streaming for JSON mode
        } else if (body.stream) {
          openRouterPayload.stream = true;
        }

        const orController = new AbortController();
        const orTimer = setTimeout(() => orController.abort(), 25000);

        const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://avelut.xyz',
            'X-Title': 'Avelut AI',
          },
          body: JSON.stringify(openRouterPayload),
          signal: orController.signal,
        });
        clearTimeout(orTimer);

        if (orResponse.ok) {
          if (openRouterPayload.stream && orResponse.body) {
            return new Response(orResponse.body, {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
              },
            });
          }
          const orData = await orResponse.json();
          const extractedText = orData?.choices?.[0]?.message?.content || '';
          return new Response(extractedText, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        const orErrText = await orResponse.text().catch(() => '');
        console.warn('[Alibaba Chat Proxy] OpenRouter fallback failed:', orResponse.status, orErrText);

        if (orResponse.status === 429) {
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

        return new Response(
          JSON.stringify({ error: `OpenRouter fallback failed: ${orResponse.status} ${orResponse.statusText}. ${orErrText}` }),
          {
            status: orResponse.status >= 400 && orResponse.status < 600 ? orResponse.status : 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      } catch (fallbackError: any) {
        console.warn('[Alibaba Chat Proxy] OpenRouter fallback fetch threw error:', fallbackError);
        return new Response(
          JSON.stringify({ error: `OpenRouter fallback threw error: ${fallbackError.message}` }),
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

    return new Response(
      JSON.stringify({ error: 'All AI model providers temporarily unavailable. Please retry.' }),
      {
        status: 503,
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

