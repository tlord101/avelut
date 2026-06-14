import { openai } from "@ai-sdk/openai"
import { convertToModelMessages, streamText, tool, UIMessage } from "ai"
import { z } from "zod"

export const maxDuration = 30

export async function POST(req: Request) {
  try {
  const { messages }: { messages: UIMessage[] } = await req.json()

  // Server-side context truncation: only process last 10 messages to optimize tokens
  const optimizedMessages = messages.slice(-10);

  const result = streamText({
    model: openai("gpt-4.1-nano"),
    system:
      "You are a helpful assistant with access to tools. Use the getCurrentDate tool when users ask about dates, time, or current information. You are also able to use the getTime tool to get the current time in a specific timezone.",
    messages: await convertToModelMessages(optimizedMessages),
    tools: {
      getTime: tool({
        description: "Get the current time in a specific timezone",
        inputSchema: z.object({
          timezone: z
            .string()
            .describe("A valid IANA timezone, e.g. 'Europe/Paris'"),
        }),
        execute: async ({ timezone }) => {
          try {
            const now = new Date()
            const time = now.toLocaleString("en-US", {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })

            return { time, timezone }
          } catch {
            return { error: "Invalid timezone format." }
          }
        },
      }),
      getCurrentDate: tool({
        description: "Get the current date and time with timezone information",
        inputSchema: z.object({}),
        execute: async () => {
          const now = new Date()
          return {
            timestamp: now.getTime(),
            iso: now.toISOString(),
            local: now.toLocaleString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              timeZoneName: "short",
            }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            utc: now.toUTCString(),
          }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse()
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
