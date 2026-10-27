/**
 * Dev-only preview (`pnpm dev`, then open /?preview): renders the signed-in app without Cognito.
 * /api calls are answered from public/preview/plan-*.json (written by `pnpm dev-config`) and a canned
 * chat stream. Vite drops this module from production builds because it is only imported under
 * `import.meta.env.DEV`.
 */
import type { ChatEvent } from '../api';

const encoder = new TextEncoder();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CHAT_REPLY = `Here's **Wednesday 4 November**:

**Creamy spinach & broccoli pasta** — 30 min, about 500 kcal per serving.

| Store | Item | Price |
|---|---|---|
| Lidl | Broccoli 750 g | 14,95 kr |
| Lidl | Spinach 450 g | 8,95 kr |

Want me to swap it for something with fish instead?`;

function sseResponse(events: ChatEvent[]): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        await delay(event.type === 'tool' ? 700 : 25);
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

export function installPreview() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const route = url.pathname.slice(4);
    await delay(200);

    const plan = /^\/plans\/(current|next)$/.exec(route);
    if (plan) {
      const response = await realFetch(`/preview/plan-${plan[1]}.json`);
      // Vite answers missing files with index.html, so check the type rather than the status.
      const isJson = response.headers.get('content-type')?.includes('json');
      return isJson ? response : new Response('{}', { status: 404 });
    }
    if (route.startsWith('/meals/')) return Response.json({ ok: true });
    if (route === '/conversations') {
      return Response.json({
        conversations: [
          { id: 'conv-preview-1', title: 'Swap Wednesday for something vegetarian', createdBy: 'Tomas', updatedAt: new Date(Date.now() - 3_600_000).toISOString() },
          { id: 'conv-preview-2', title: 'We are both allergic to shrimp', createdBy: 'Ida', updatedAt: new Date(Date.now() - 86_400_000 * 2).toISOString() },
        ],
      });
    }
    if (route.startsWith('/conversations/')) {
      return Response.json({
        messages: [
          { role: 'user', text: '[Ida] We are both allergic to shrimp', timestamp: new Date().toISOString() },
          { role: 'assistant', text: 'Noted! I saved a **shrimp allergy** for both of you.', timestamp: new Date().toISOString() },
        ],
      });
    }
    if (route === '/chat') {
      const words = CHAT_REPLY.split(/(?<=\s)/);
      return sseResponse([
        { type: 'conversation', id: 'conv-preview-3' },
        { type: 'tool', name: 'get_plan' },
        ...words.map((delta) => ({ type: 'text' as const, delta })),
        { type: 'done' },
      ]);
    }
    return new Response('{}', { status: 404 });
  };
}
