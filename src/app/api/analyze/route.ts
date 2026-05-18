import Anthropic from '@anthropic-ai/sdk';
import { HYDROLOOP_SYSTEM_PROMPT, formatBatchMessage } from '@/lib/system-prompt';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured. Add it to .env.local.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const body = await request.json();
  const userMessage = formatBatchMessage(body);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    stream: true,
    system: HYDROLOOP_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
