// Airtable API Client
// Handles auth, request timeouts, circuit breaker, retry, and rate limiting
// Airtable Web API v0 — https://api.airtable.com/v0
// Rate limit: 5 req/sec per base — enforced via per-base rate limiting

import { logger } from "./logger.js";

export const AIRTABLE_BASE_URL = "https://api.airtable.com";
export const AIRTABLE_META_URL = "https://api.airtable.com/v0/meta";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

// Airtable rate limit: 5 req/sec per base = 200ms between requests per base
const RATE_LIMIT_INTERVAL_MS = 220; // slightly above 200ms for safety

// ============================================
// CIRCUIT BREAKER
// ============================================
type CircuitState = "closed" | "open" | "half-open";

class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenLock = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        if (!this.halfOpenLock) {
          this.halfOpenLock = true;
          this.state = "half-open";
          logger.info("circuit_breaker.half_open");
          return true;
        }
        return false;
      }
      return false;
    }
    return false;
  }

  recordSuccess(): void {
    this.halfOpenLock = false;
    if (this.state !== "closed") {
      logger.info("circuit_breaker.closed", { previousFailures: this.failureCount });
    }
    this.failureCount = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.halfOpenLock = false;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold || this.state === "half-open") {
      this.state = "open";
      logger.warn("circuit_breaker.open", {
        failureCount: this.failureCount,
        resetAfterMs: this.resetTimeoutMs,
      });
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// ============================================
// PER-BASE RATE LIMITER
// Airtable: 5 req/sec per base. Track last request time per base.
// ============================================
class RateLimiter {
  private lastRequestTime = new Map<string, number>();

  async wait(baseId: string): Promise<void> {
    const last = this.lastRequestTime.get(baseId);
    if (last) {
      const elapsed = Date.now() - last;
      if (elapsed < RATE_LIMIT_INTERVAL_MS) {
        const waitMs = RATE_LIMIT_INTERVAL_MS - elapsed;
        logger.debug("rate_limiter.waiting", { baseId, waitMs });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    this.lastRequestTime.set(baseId, Date.now());
  }
}

// ============================================
// AIRTABLE API CLIENT
// ============================================
export class AirtableClient {
  private accessToken: string;
  private timeoutMs: number;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: RateLimiter;

  constructor(accessToken: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.accessToken = accessToken;
    this.timeoutMs = timeoutMs;
    this.circuitBreaker = new CircuitBreaker();
    this.rateLimiter = new RateLimiter();
  }

  private getHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  // Extract base ID from endpoint for rate limiting (e.g., /v0/appXXXX/Table → appXXXX)
  private extractBaseId(endpoint: string): string {
    const match = endpoint.match(/\/v0\/(app[^/]+)/);
    return match ? match[1] : "global";
  }

  async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error("Circuit breaker is open — Airtable API unavailable. Retry after 60 seconds.");
    }

    // Apply per-base rate limiting
    const baseId = this.extractBaseId(endpoint);
    await this.rateLimiter.wait(baseId);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
      const requestId = logger.requestId();
      const start = performance.now();

      try {
        logger.debug("api_request.start", {
          requestId,
          method: options.method || "GET",
          endpoint,
          attempt: attempt + 1,
        });

        const url = endpoint.startsWith("http") ? endpoint : `${AIRTABLE_BASE_URL}${endpoint}`;

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: { ...this.getHeaders(), ...(options.headers as Record<string, string> || {}) },
        });

        const durationMs = Math.round(performance.now() - start);

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") || "5", 10);
          logger.warn("api_request.rate_limited", { requestId, retryAfter, endpoint });
          clearTimeout(timeoutId);
          await this.delay(retryAfter * 1000);
          // Re-apply rate limit after retry
          await this.rateLimiter.wait(baseId);
          continue;
        }

        if (response.status >= 500) {
          this.circuitBreaker.recordFailure();
          lastError = new Error(`Server error: ${response.status} ${response.statusText}`);
          logger.warn("api_request.server_error", { requestId, durationMs, status: response.status, endpoint, attempt: attempt + 1 });
          clearTimeout(timeoutId);
          const baseDelay = RETRY_BASE_DELAY * Math.pow(2, attempt);
          const jitter = Math.random() * baseDelay * 0.5;
          await this.delay(baseDelay + jitter);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = errorBody;
          try {
            const parsed = JSON.parse(errorBody);
            errorMessage = parsed.error?.message || parsed.message || errorBody;
          } catch {}
          logger.error("api_request.client_error", { requestId, durationMs, status: response.status, endpoint, body: errorBody.slice(0, 500) });
          throw new Error(`Airtable API error ${response.status}: ${errorMessage}`);
        }

        this.circuitBreaker.recordSuccess();
        logger.debug("api_request.done", { requestId, durationMs, status: response.status, endpoint });

        if (response.status === 204 || response.headers.get("content-length") === "0") {
          return { success: true } as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          this.circuitBreaker.recordFailure();
          lastError = new Error(`Request timeout after ${this.timeoutMs}ms: ${endpoint}`);
          logger.error("api_request.timeout", { endpoint, timeoutMs: this.timeoutMs });
          continue;
        }
        if (error instanceof Error && !error.message.startsWith("Server error")) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  async post<T = unknown>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async patch<T = unknown>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async put<T = unknown>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async delete<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  async healthCheck(): Promise<{ reachable: boolean; authenticated: boolean; latencyMs: number; error?: string }> {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        // Use the Metadata API to list bases — validates both connectivity and auth
        const response = await fetch(`${AIRTABLE_BASE_URL}/v0/meta/bases?pageSize=1`, {
          signal: controller.signal,
          headers: this.getHeaders(),
        });
        const latencyMs = Math.round(performance.now() - start);
        return {
          reachable: true,
          authenticated: response.status !== 401 && response.status !== 403,
          latencyMs,
          ...(response.status >= 400 ? { error: `Status ${response.status}` } : {}),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return {
        reachable: false,
        authenticated: false,
        latencyMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
