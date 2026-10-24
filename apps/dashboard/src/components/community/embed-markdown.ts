/**
 * Minimal Discord-markdown tokenizer for previews. Produces plain tokens (never
 * HTML), so user text can't inject markup. Supports **bold**, *italic* / _italic_,
 * `code`, and mention syntax (<@id>, <@&id>, <#id>) shown as readable pills.
 */
export type MdToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'mention'; text: string };

const RE =
  /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\*[^*\n]+\*)|(_[^_\n]+_)|(<@&\d{17,20}>)|(<@!?\d{17,20}>)|(<#\d{17,20}>)|(@everyone|@here)/g;

export interface MentionNames {
  role?: (id: string) => string | undefined;
  channel?: (id: string) => string | undefined;
}

export function tokenizeLine(line: string, names: MentionNames = {}): MdToken[] {
  const out: MdToken[] = [];
  let last = 0;
  for (const m of line.matchAll(RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: 'text', text: line.slice(last, idx) });
    const s = m[0];
    if (m[1]) out.push({ kind: 'bold', text: s.slice(2, -2) });
    else if (m[2]) out.push({ kind: 'code', text: s.slice(1, -1) });
    else if (m[3] || m[4]) out.push({ kind: 'italic', text: s.slice(1, -1) });
    else if (m[5]) {
      const id = s.slice(3, -1);
      out.push({ kind: 'mention', text: `@${names.role?.(id) ?? 'role'}` });
    } else if (m[6]) out.push({ kind: 'mention', text: '@member' });
    else if (m[7]) {
      const id = s.slice(2, -1);
      out.push({ kind: 'mention', text: `#${names.channel?.(id) ?? 'channel'}` });
    } else out.push({ kind: 'mention', text: s });
    last = idx + s.length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

/** Fill `{user}` / `{server}` placeholders for the welcome preview. */
export function fillWelcomePlaceholders(template: string, vars: { user: string; server: string }): string {
  return template.replaceAll('{user}', vars.user).replaceAll('{server}', vars.server);
}

/** Placeholders the welcome message may use; anything else in `{…}` is rejected by the service. */
export function unknownPlaceholders(
  template: string,
  allowed: readonly string[] = ['user', 'server'],
): string[] {
  return [...template.matchAll(/\{([^{}\s]{1,32})\}/g)].map((m) => m[1]!).filter((p) => !allowed.includes(p));
}

export function colorToCss(hex: string | null | undefined, fallback = '#22D3EE'): string {
  if (!hex) return fallback;
  const v = hex.startsWith('#') ? hex : `#${hex}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}
