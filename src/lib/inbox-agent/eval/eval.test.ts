// Eval del borrador IA.
//  - Offline (siempre): los casos `rulesOnly` deben salir bien solo con reglas, sin LLM.
//  - En vivo (opcional, gasta tokens): llama al modelo real con los 16 casos e imprime aciertos.
//      INBOX_AGENT_EVAL_LIVE=1 ANTHROPIC_API_KEY=... npx vitest run src/lib/inbox-agent/eval
//    No escribe en ninguna base de datos ni envía nada.
import { describe, expect, it } from "vitest";
import { classifyIntent } from "../supervisor";
import { draftFromContext } from "../specialist";
import { makeAnthropicLlm } from "../llm";
import { EVAL_CASES } from "./cases";
import type { ChatTurn, DraftContext } from "../types";

const turnOf = (text: string): ChatTurn[] => [{ role: "paciente", text, at: new Date().toISOString() }];

describe("eval offline (reglas)", () => {
  for (const c of EVAL_CASES.filter((x) => x.rulesOnly)) {
    it(`${c.id} → ${c.expected}`, async () => {
      const d = await classifyIntent(turnOf(c.message), { llm: null });
      expect(d.intent).toBe(c.expected);
    });
  }
});

const LIVE = process.env.INBOX_AGENT_EVAL_LIVE === "1";

describe.skipIf(!LIVE)("eval en vivo (modelo real)", () => {
  it("clasifica y redacta los casos", async () => {
    const llm = makeAnthropicLlm({ timeoutMs: 60_000 });
    expect(llm, "falta ANTHROPIC_API_KEY").not.toBeNull();
    let ok = 0;
    const rows: string[] = [];
    for (const c of EVAL_CASES) {
      const ctx: DraftContext = {
        lead_first_name: "Lucía",
        turns: turnOf(c.message),
        amelia: { found: false, excluded: false, upcoming: [], active_packages: [], remaining_sessions_total: 0, attended_sessions: 0 },
        playbook: [],
      };
      const { result, meta } = await draftFromContext(ctx, { llm });
      const hit = result.intent === c.expected;
      if (hit) ok++;
      rows.push(`${hit ? "✓" : "✗"} ${c.id.padEnd(20)} esperado=${c.expected.padEnd(16)} obtenido=${result.intent.padEnd(16)} (${meta.decision.source}) · ${result.draft_reply.replace(/\n/g, " ").slice(0, 90)}`);
      expect(result.draft_reply).not.toMatch(/gratis|gratu/i);
    }
    console.log(`\nEval inbox-agent: ${ok}/${EVAL_CASES.length}\n${rows.join("\n")}`);
    expect(ok / EVAL_CASES.length).toBeGreaterThanOrEqual(0.8);
  }, 600_000);
});
