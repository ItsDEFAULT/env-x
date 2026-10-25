/**
 * Line-preserving dotenv parser. Environments are stored as raw text so that
 * comments, ordering and blank lines survive every round trip; this module
 * reads values out of that text and makes surgical edits to it.
 *
 * Semantics follow the `dotenv` package: later duplicates win, double-quoted
 * values expand only \n and \r, single/backtick quotes are literal, and an
 * unquoted value ends at a whitespace-preceded `#`.
 */

export interface EnvEntry {
  key: string;
  value: string;
  /** 0-based index of the first line of the assignment. */
  start: number;
  /** 0-based index of the last line (differs from start for multiline values). */
  end: number;
  exported: boolean;
}

const ASSIGN_RE = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function findClose(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote === '"' && c === '\\') {
      i++;
      continue;
    }
    if (c === quote) return i;
  }
  return -1;
}

export function parseEnv(text: string): EnvEntry[] {
  const lines = splitLines(text);
  const entries: EnvEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = ASSIGN_RE.exec(lines[i]);
    if (!m) continue;
    const exported = Boolean(m[1]);
    const key = m[2];
    const rest = m[3];
    const quote = rest[0];

    if (quote === '"' || quote === "'" || quote === '`') {
      let body = rest.slice(1);
      let j = i;
      let close = findClose(body, quote);
      while (close < 0 && j + 1 < lines.length) {
        j++;
        body += '\n' + lines[j];
        close = findClose(body, quote);
      }
      if (close >= 0) {
        let value = body.slice(0, close);
        if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
        entries.push({ key, value, start: i, end: j, exported });
        i = j;
        continue;
      }
      // Unterminated quote: fall through and treat the line as unquoted.
    }

    const value = rest.replace(/\s+#.*$/, '').trim();
    entries.push({ key, value, start: i, end: i, exported });
  }

  return entries;
}

/** Key/value view of an env text; later duplicates win, as in dotenv. */
export function toRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of parseEnv(text)) out[e.key] = e.value;
  return out;
}

/** Serialize a value so that `parseEnv` (and dotenv) reads it back unchanged. */
export function formatValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+,=~*^!?-]*$/.test(value)) return value;
  const multiline = /[\r\n]/.test(value);
  if (!multiline && !value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
  if (!value.includes('`')) return '`' + value + '`';
  // dotenv cannot represent this value exactly; keep it on one line, quoted.
  return `"${value.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

function joinLines(lines: string[], original: string): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  return lines.join(eol);
}

/** Set `key` to `value`, editing the last existing assignment in place or appending. */
export function setVar(text: string, key: string, value: string): string {
  const entries = parseEnv(text).filter((e) => e.key === key);
  const lines = splitLines(text);
  const last = entries[entries.length - 1];

  if (last) {
    const line = `${last.exported ? 'export ' : ''}${key}=${formatValue(value)}`;
    lines.splice(last.start, last.end - last.start + 1, line);
    return joinLines(lines, text);
  }

  const line = `${key}=${formatValue(value)}`;
  if (text === '') return line + '\n';
  if (lines[lines.length - 1] === '') {
    lines.splice(lines.length - 1, 0, line);
  } else {
    lines.push(line);
  }
  return joinLines(lines, text);
}

/** Remove every assignment of `key`. */
export function unsetVar(text: string, key: string): string {
  const entries = parseEnv(text).filter((e) => e.key === key);
  if (entries.length === 0) return text;
  const lines = splitLines(text);
  for (const e of [...entries].reverse()) lines.splice(e.start, e.end - e.start + 1);
  return joinLines(lines, text);
}

export interface EnvDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

/** Key-level diff: what changes when moving from `from` to `to`. */
export function diffEnv(from: string, to: string): EnvDiff {
  const a = toRecord(from);
  const b = toRecord(to);
  const diff: EnvDiff = { added: [], removed: [], changed: [], unchanged: [] };
  for (const key of Object.keys(b)) {
    if (!(key in a)) diff.added.push(key);
    else if (a[key] !== b[key]) diff.changed.push(key);
    else diff.unchanged.push(key);
  }
  for (const key of Object.keys(a)) if (!(key in b)) diff.removed.push(key);
  return diff;
}

/** Hide a secret while keeping enough shape to recognize it. */
export function maskValue(value: string): string {
  if (value === '') return '';
  if (value.length <= 8) return '•'.repeat(6);
  return value.slice(0, 3) + '•'.repeat(6) + ` (${value.length} chars)`;
}

/** Fast non-cryptographic string hash (cyrb53), used for drift detection. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
