export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-DashScope-WorkSpace',
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey =
      process.env.ALIBABA_API_KEY ||
      process.env.VITE_ALIBABA_API_KEY ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Alibaba Cloud DashScope API Key is not configured on the server' }),
        {
          status: 500,
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

    const baseUrl =
      process.env.ALIBABA_OPENAI_COMPATIBLE_URL ||
      process.env.VITE_ALIBABA_OPENAI_COMPATIBLE_URL ||
      'https://ws-o3v6mh0i8y9tqdfx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (workspaceId) {
      requestHeaders['X-DashScope-WorkSpace'] = workspaceId;
    }

    // Normalize model name for DashScope OpenAI-compatible endpoint
    const messages = body.messages || [];
    const hasImage = messages.some((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.type === 'image_url')
    );

    let model = 'qwen3.7-flash';
    if (hasImage) {
      model = 'qwen-vl-plus';
    } else if (body.model) {
      model = String(body.model).trim();
    }

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

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(errorText, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // If streaming, pipe SSE stream directly
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
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal Alibaba Chat Proxy Error' }),
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

