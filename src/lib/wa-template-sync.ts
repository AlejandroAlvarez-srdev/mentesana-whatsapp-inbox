// Plantillas como código. El catálogo vive en el repositorio; esta función compara lo que
// queremos con lo que hay en la cuenta de WhatsApp y devuelve un plan, sin tocar nada:
//   create     no existe en la cuenta → se crea
//   unchanged  existe y dice lo mismo
//   drift      existe con el mismo nombre pero otro contenido. Meta no deja editar una plantilla
//              en revisión y limita las ediciones de las aprobadas, así que no se "actualiza":
//              se propone un nombre nuevo versionado y la antigua se retira cuando la nueva se apruebe
//   blocked    el linter de cumplimiento la rechaza → no se crea, con los motivos
//   orphan     está en la cuenta y no en el catálogo (creada a mano desde el panel de Meta)
// Sirve para montar una cuenta nueva desde cero con un solo comando revisable y para detectar
// plantillas creadas fuera del circuito.

import { buildComponents, type WaComponent, type WaTemplateInput } from "./wa-template-builder";
import { hasErrors, lintTemplate, type Finding, type PolicyOptions } from "./wa-template-policy";

export type RemoteTemplate = { name: string; language: string; category: string; status: string; components: WaComponent[] };

export type SyncAction =
  | { kind: "create"; name: string; template: WaTemplateInput; warnings: Finding[] }
  | { kind: "unchanged"; name: string; status: string }
  | { kind: "drift"; name: string; status: string; suggestedName: string; changed: string[] }
  | { kind: "blocked"; name: string; findings: Finding[] }
  | { kind: "orphan"; name: string; status: string };

/** Huella del contenido que ve el destinatario: ignora ejemplos, espacios y el orden de los botones. */
export function fingerprint(components: WaComponent[]): Record<string, string> {
  const squash = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();
  const out: Record<string, string> = {};
  for (const c of components) {
    if (c.type === "BUTTONS") out.BUTTONS = (c.buttons ?? []).map(b => `${b.type}:${squash(b.text)}:${b.url ?? b.phone_number ?? ""}`).sort().join("|");
    else out[c.type] = squash(c.text);
  }
  return out;
}

export function planSync(catalog: WaTemplateInput[], remote: RemoteTemplate[], policy: PolicyOptions): SyncAction[] {
  const key = (name: string, language: string) => `${name}\u0000${language}`;
  const remoteByKey = new Map(remote.map(r => [key(r.name, r.language), r]));
  const remoteNames = new Set(remote.map(r => r.name));
  const wanted = new Set(catalog.map(t => key(t.name, t.language)));
  const plan: SyncAction[] = [];

  for (const t of catalog) {
    const findings = lintTemplate(t, policy);
    const existing = remoteByKey.get(key(t.name, t.language));
    if (!existing) {
      plan.push(hasErrors(findings)
        ? { kind: "blocked", name: t.name, findings: findings.filter(f => f.severity === "error") }
        : { kind: "create", name: t.name, template: t, warnings: findings });
      continue;
    }
    const want = fingerprint(buildComponents(t)), got = fingerprint(existing.components);
    const changed = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter(k => want[k] !== got[k]);
    if (existing.category !== t.category) changed.push("CATEGORY");
    plan.push(changed.length
      ? { kind: "drift", name: t.name, status: existing.status, suggestedName: nextVersionName(t.name, remoteNames), changed }
      : { kind: "unchanged", name: t.name, status: existing.status });
  }
  for (const r of remote) if (!wanted.has(key(r.name, r.language))) plan.push({ kind: "orphan", name: r.name, status: r.status });
  return plan;
}

/** `aviso` → `aviso_v2`; `aviso_v2` → `aviso_v3`; salta los nombres que ya existen en la cuenta. */
export function nextVersionName(name: string, taken: Set<string>): string {
  const m = /^(.*)_v(\d+)$/.exec(name);
  const base = m ? m[1] : name;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken.has(`${base}_v${n}`)) n++;
  return `${base}_v${n}`;
}

/** Resumen de una línea para el registro del comando o el comentario del PR. */
export function summarize(plan: SyncAction[]): string {
  const count = (kind: SyncAction["kind"]) => plan.filter(a => a.kind === kind).length;
  return (["create", "unchanged", "drift", "blocked", "orphan"] as const).map(k => `${count(k)} ${k}`).join(" · ");
}
