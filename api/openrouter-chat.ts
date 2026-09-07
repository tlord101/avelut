export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, HTTP-Referer, X-Title',
    },
  });
}

const FALLBACK_MODELS = [
  'qwen/qwen3.7-flash',
  'qwen/qwen-2.5-72b-instruct',
  'google/gemini-2.5-flash',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey =
      process.env.OPENROUTER_API_KEY ||
      process.env.VITE_OPENROUTER_API_KEY ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';

    const baseUrl = 'https://openrouter.ai/api/v1';

    const requestHeaders: Record<string, string> = {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://avelut.xyz',
      'X-Title': 'Avelut AI',
    };

    const messages = body.messages || [];
    const primaryModel = process.env.OPENROUTER_MODEL || process.env.VITE_OPENROUTER_MODEL || body.model || 'qwen/qwen3.7-flash';

    const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));

    let lastResponse: Response | null = null;
    let lastErrorText = '';

    for (const model of candidateModels) {
      const payload: any = {
        model,
        messages,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 4096,
      };

      if (body.stream) {
        payload.stream = true;
        if (body.stream_options) {
          payload.stream_options = body.stream_options;
        }
      }

      if (body.response_format) {
        payload.response_format = body.response_format;
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        if (body.stream && response.body) {
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

        const data = await response.text();
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      lastErrorText = await response.text();
      lastResponse = response;

      // If 401 or auth issue without fallback key, retry won't fix it on this model, but try next model if 429 or 5xx
      if (response.status !== 429 && response.status < 500) {
        break;
      }
    }

    return new Response(lastErrorText || JSON.stringify({ error: 'All OpenRouter models failed' }), {
      status: lastResponse?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal OpenRouter Chat Proxy Error' }),
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
