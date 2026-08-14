import type {
  ApprovalDecision,
  ApprovalRecord,
  ApprovalQueueFilter,
  ApprovalStatus,
  ApprovalStore,
  ApprovalSubscriptionEvent,
  AuditEvent,
} from "./types";
import { consumeApprovalEvents } from "./sse";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface DecisionResult {
  record: ApprovalRecord;
  resume_value: unknown;
}

export interface HttpApprovalStoreOptions {
  baseUrl: string;
  fetcher?: Fetcher;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
}

/** Connect the React primitives to a Countersign-compatible approval API. */
export class HttpApprovalStore implements ApprovalStore {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly headers: Headers;
  private readonly credentials: RequestCredentials;

  constructor({
    baseUrl,
    fetcher = globalThis.fetch,
    headers,
    credentials = "include",
  }: HttpApprovalStoreOptions) {
    if (!fetcher) {
      throw new Error(
        "A fetch implementation is required to use HttpApprovalStore",
      );
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetcher = fetcher;
    this.headers = new Headers(headers);
    this.credentials = credentials;
  }

  async list(
    input: ApprovalQueueFilter & { signal?: AbortSignal } = {},
  ): Promise<ApprovalRecord[]> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (key !== "signal" && value !== undefined) {
        parameters.set(key, String(value));
      }
    }
    const query = parameters.size ? `?${parameters.toString()}` : "";
    return this.request<ApprovalRecord[]>(`/v0/approvals${query}`, {
      signal: input.signal,
    });
  }

  async get(id: string, signal?: AbortSignal): Promise<ApprovalRecord | null> {
    const response = await this.fetcher(
      `${this.baseUrl}/v0/approvals/${encodeURIComponent(id)}`,
      {
        signal,
        headers: this.headers,
        credentials: this.credentials,
      },
    );
    if (response.status === 404) {
      return null;
    }
    return this.read<ApprovalRecord>(response);
  }

  async decide(
    id: string,
    decision: ApprovalDecision,
    signal?: AbortSignal,
  ): Promise<ApprovalRecord> {
    const result = await this.request<DecisionResult>(
      `/v0/approvals/${encodeURIComponent(id)}/decisions`,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    return result.record;
  }

  async audit(id: string, signal?: AbortSignal): Promise<AuditEvent[]> {
    return this.request<AuditEvent[]>(
      `/v0/approvals/${encodeURIComponent(id)}/audit`,
      { signal },
    );
  }

  subscribe(
    listener: (event: ApprovalSubscriptionEvent) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const controller = new AbortController();
    void consumeApprovalEvents({
      url: `${this.baseUrl}/v0/events`,
      fetcher: this.fetcher,
      headers: this.headers,
      credentials: this.credentials,
      signal: controller.signal,
      listener,
    }).catch((error: unknown) => {
      onError?.(
        error instanceof Error
          ? error
          : new Error("Approval event stream failed"),
      );
    });
    return () => controller.abort();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(this.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    return this.read<T>(
      await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        credentials: init?.credentials ?? this.credentials,
        headers,
      }),
    );
  }

  private async read<T>(response: Response): Promise<T> {
    if (response.ok) {
      return response.json() as Promise<T>;
    }
    const fallback = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      throw new Error(body.detail || fallback);
    } catch (error) {
      if (error instanceof Error && error.message !== fallback) {
        throw error;
      }
      throw new Error(fallback);
    }
  }
}
