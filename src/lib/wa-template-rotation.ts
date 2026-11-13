// Rotación de variaciones de una plantilla. Las agentes tienen cinco redacciones del mismo
// mensaje (`renovacion_1` … `renovacion_5`); en vez de que cada una elija "la suya" de memoria,
// el panel propone cuál toca para ESE contacto:
//   1. nunca la misma que recibió la última vez, ni una que ya haya visto si queda alguna sin ver;
//   2. solo variaciones aprobadas y con calidad sana (las pausadas o en rojo no se ofrecen);
//   3. si el contacto se dio de baja, o recibió marketing hace poco, no se propone ninguna.
// La elección entre candidatas equivalentes es determinista (misma entrada → misma salida), para
// que dos agentes que abren el mismo chat vean la misma propuesta y para poder probarla.
//
// Importante: rotar el texto evita que el mensaje parezca copia y pega; no sustituye al punto 3.
// Lo que marca un número como spam es a quién se escribe y cada cuánto, no la redacción.

export type Variant = {
  name: string;
  category: "MARKETING" | "UTILITY";
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";
  /** Calidad que informa Meta para la plantilla. */
  quality?: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
};

export type SentRecord = { template: string; category: "MARKETING" | "UTILITY"; at: Date };

export type RotationInput = {
  /** Clave estable del contacto (teléfono normalizado o id interno). */
  contact: string;
  variants: Variant[];
  /** Plantillas que este contacto ya recibió, en cualquier orden. */
  history: SentRecord[];
  optedOut: boolean;
  now: Date;
  /** Días que deben pasar entre dos mensajes de marketing al mismo contacto. */
  marketingCooldownDays?: number;
};

export type RotationResult =
  | { ok: true; variant: string; reason: "unseen" | "least-recent" }
  | { ok: false; skip: "opted-out" | "cooldown" | "no-healthy-variant"; retryAt?: Date };

const DAY = 86_400_000;

export function pickVariant(input: RotationInput): RotationResult {
  const { contact, variants, history, optedOut, now, marketingCooldownDays = 14 } = input;
  if (optedOut) return { ok: false, skip: "opted-out" };

  const usable = variants.filter(v => v.status === "APPROVED" && v.quality !== "RED" && v.quality !== "YELLOW");
  if (!usable.length) return { ok: false, skip: "no-healthy-variant" };

  // El descanso solo aplica al marketing: un recordatorio de cita se manda aunque ayer hubiera oferta.
  if (usable.some(v => v.category === "MARKETING")) {
    const lastMarketing = Math.max(-Infinity, ...history.filter(h => h.category === "MARKETING").map(h => h.at.getTime()));
    const retryAt = lastMarketing + marketingCooldownDays * DAY;
    if (retryAt > now.getTime()) return { ok: false, skip: "cooldown", retryAt: new Date(retryAt) };
  }

  const lastSeen = new Map<string, number>();
  for (const h of history) lastSeen.set(h.template, Math.max(lastSeen.get(h.template) ?? 0, h.at.getTime()));

  const unseen = usable.filter(v => !lastSeen.has(v.name));
  if (unseen.length) return { ok: true, variant: tieBreak(unseen, contact).name, reason: "unseen" };

  // Las ha visto todas: la que hace más tiempo que no recibe.
  const oldest = Math.min(...usable.map(v => lastSeen.get(v.name)!));
  return { ok: true, variant: tieBreak(usable.filter(v => lastSeen.get(v.name) === oldest), contact).name, reason: "least-recent" };
}

/** Reparte a los contactos entre las candidatas de forma estable y pareja. */
function tieBreak(candidates: Variant[], contact: string): Variant {
  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  return sorted[fnv1a(contact) % sorted.length];
}

/** FNV-1a de 32 bits: suficiente para repartir, sin dependencias y sin `crypto` (corre en el navegador). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Familia de una variación: `renovacion_3` → `renovacion`; `recordatorio_24h` no es variación de nada. */
export function familyOf(templateName: string): string | null {
  const m = /^(.+)_(\d{1,2})$/.exec(templateName);
  return m ? m[1] : null;
}

/** Agrupa las plantillas de una cuenta en familias de variaciones (solo las que tienen dos o más). */
export function groupFamilies<T extends { name: string }>(templates: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const t of templates) {
    const family = familyOf(t.name);
    if (!family) continue;
    groups.set(family, [...(groups.get(family) ?? []), t]);
  }
  for (const [family, members] of groups) if (members.length < 2) groups.delete(family);
  return groups;
}
