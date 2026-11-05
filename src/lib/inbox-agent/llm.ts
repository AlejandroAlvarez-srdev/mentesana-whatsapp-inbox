// Llamada a Claude por fetch a la Messages API — mismo patrón que src/lib/auto-route.ts
// (ANTHROPIC_API_KEY limpiada de caracteres no imprimibles, anthropic-version 2023-06-01).
import type { LlmFn } from "./types";

export function anthropicKey(): string {
  return (process.env.ANTHROPIC_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim();
}

export function makeAnthropicLlm(opts: { timeoutMs?: number } = {}): LlmFn | null {
  const key = anthropicKey();
  if (!key) return null;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  return async ({ system, user, model, maxTokens }) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const d = (await r.json()) as { content?: { type?: string; text?: string }[] };
      return (d.content ?? []).filter((c) => c.type === "text" || typeof c.text === "string").map((c) => c.text ?? "").join("");
    } finally {
      clearTimeout(timer);
    }
  };
}
