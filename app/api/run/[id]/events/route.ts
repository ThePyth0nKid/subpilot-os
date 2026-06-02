import type { AgentEvent } from "@/lib/domain/events";
import { exists, subscribe } from "@/lib/orchestrator/store";

export const runtime = "nodejs";
export const maxDuration = 300;

function isTerminal(event: AgentEvent): boolean {
  return (
    event.agent === "orchestrator" &&
    (event.phase === "completed" || event.phase === "error")
  );
}

/** SSE stream of typed AgentEvents for one run. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!exists(id)) {
    return new Response("Unknown run", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};

      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: AgentEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          close();
          return;
        }
        if (isTerminal(event)) close();
      };

      controller.enqueue(encoder.encode(": connected\n\n"));
      unsubscribe = subscribe(id, send);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
