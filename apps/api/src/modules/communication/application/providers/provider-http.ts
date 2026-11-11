/**
 * PHASE-041 (T-02) — the provider HTTP transport seam.
 *
 * Every real adapter speaks HTTP EXCLUSIVELY through this seam (BR-067's
 * testability half): production binds `fetchProviderTransport` (global
 * fetch with a bounded timeout); the adapter contract suite binds fakes
 * that assert the exact wire shape (URL, headers, body) and drive success/
 * failure/retry paths; the network-blocked proof binds a transport that
 * THROWS on any invocation — proving the SANDBOX default never builds one.
 *
 * No adapter imports fetch directly — the repo grep for BR-067
 * ("no provider is invoked outside the port") leans on this.
 */

export interface HttpProviderRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Bounded default 10s — a hung provider must never pin a worker. */
  readonly timeoutMs?: number;
}

export interface HttpProviderResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type ProviderHttpTransport = (
  request: HttpProviderRequest,
) => Promise<HttpProviderResponse>;

/** Network failure shape (retryable — transient by definition). */
export class ProviderTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderTransportError";
  }
}

/** The production transport: global fetch + abort-based timeout. */
export const fetchProviderTransport: ProviderHttpTransport = async (request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 10_000);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, body: await response.text(), headers };
  } catch (error) {
    throw new ProviderTransportError(
      `network: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * A helper for JSON POSTs (the adapters' common wire shape). URL-encoding
 * (Twilio/Mailgun form bodies) is built by the adapters themselves —
 * providers differ in encoding and the wire assertions must see the exact
 * bytes.
 */
export function jsonPost(
  transport: ProviderHttpTransport,
  url: string,
  headers: Readonly<Record<string, string>>,
  payload: unknown,
  timeoutMs?: number,
): Promise<HttpProviderResponse> {
  return transport({
    url,
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    timeoutMs,
  });
}

/** Best-effort JSON parse (provider bodies are advisory traces). */
export function parseJsonBody(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
