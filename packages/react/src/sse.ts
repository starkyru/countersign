import type { ApprovalSubscriptionEvent } from "./types";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface ConsumeApprovalEventsOptions {
  url: string;
  fetcher: Fetcher;
  headers: Headers;
  credentials: RequestCredentials;
  signal: AbortSignal;
  listener(event: ApprovalSubscriptionEvent): void;
  retryDelay?: typeof abortableDelay;
}

interface ParsedSseEvent {
  id?: string;
  data?: string;
  retry?: number;
}

const initialRetryMs = 1_000;
const minimumRetryMs = 250;
const maximumRetryMs = 10_000;

export class ApprovalEventStreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApprovalEventStreamError";
  }
}

function parseEvent(block: string): ParsedSseEvent {
  const data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const value =
      separator === -1 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    if (field === "id" && !value.includes("\0")) id = value;
    if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
  }
  return {
    ...(id !== undefined ? { id } : {}),
    ...(data.length ? { data: data.join("\n") } : {}),
    ...(retry !== undefined ? { retry } : {}),
  };
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", finish);
      globalThis.clearTimeout(timeout);
      resolve();
    };
    const timeout = globalThis.setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function readStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: ParsedSseEvent) => void,
): Promise<void> {
  if (!response.body)
    throw new Error("The event stream response did not include a body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) onEvent(parseEvent(block));
      if (done) return;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

export async function consumeApprovalEvents({
  url,
  fetcher,
  headers,
  credentials,
  signal,
  listener,
  retryDelay = abortableDelay,
}: ConsumeApprovalEventsOptions): Promise<void> {
  let cursor: string | undefined;
  let retryMs = initialRetryMs;
  while (!signal.aborted) {
    try {
      const requestHeaders = new Headers(headers);
      requestHeaders.set("accept", "text/event-stream");
      if (cursor) requestHeaders.set("last-event-id", cursor);
      const response = await fetcher(url, {
        credentials,
        headers: requestHeaders,
        signal,
      });
      if (!response.ok) {
        throw new ApprovalEventStreamError(
          `Event stream failed with ${response.status}`,
          response.status,
        );
      }
      retryMs = initialRetryMs;
      await readStream(response, signal, (event) => {
        if (event.id !== undefined) cursor = event.id;
        if (event.retry !== undefined) {
          retryMs = Math.max(
            minimumRetryMs,
            Math.min(event.retry, maximumRetryMs),
          );
        }
        if (!event.data) return;
        listener(JSON.parse(event.data) as ApprovalSubscriptionEvent);
      });
      if (!signal.aborted) await retryDelay(retryMs, signal);
    } catch (error) {
      if (signal.aborted) return;
      if (
        error instanceof ApprovalEventStreamError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        throw error;
      }
      await retryDelay(retryMs, signal);
      retryMs = Math.min(retryMs * 2, maximumRetryMs);
    }
  }
}
