/** Reading structure out of an ASC name. */

const SEGMENT_ORDER = ['V', 'D', 'J', 'C'];

/** V, D, J or C, from the fourth character of an ASC name (IGHV1-2 -> V). */
export function segmentOf(gene: string): string {
  const code = (gene ?? '').charAt(3).toUpperCase();
  return SEGMENT_ORDER.includes(code) ? code : '?';
}

/** IGHV1-2 -> IGHV1, so genes collect under a family heading. */
export function familyOf(gene: string): string {
  const match = (gene ?? '').match(/^([A-Z]{2,3}[VDJC]\d*)/);
  return match ? match[1] : gene;
}

/** Segments present in a gene list, in V/D/J/C order, with their counts. */
export function segmentsIn(genes: string[],
                           by: Record<string, string> = {}): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const gene of genes) {
    const code = by[gene] ?? segmentOf(gene);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...SEGMENT_ORDER, '?']
    .filter(code => counts.has(code))
    .map(code => ({ code, count: counts.get(code) }));
}

export function segmentLabel(code: string): string {
  return code === '?' ? 'Other' : code;
}

/** The one allele-label rule for the whole app. */
const NAME_LIMIT = 26;

/** FNV-1a 32-bit, mirrored byte-for-byte in refbook.py. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Three base36 characters of that hash - stable for an allele, whatever else is loaded. */
function suffixToken(suffix: string): string {
  const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  let h = fnv1a(suffix);
  let out = '';
  for (let i = 0; i < 3; i++) { out += B36[h % 36]; h = Math.floor(h / 36); }
  return out;
}


/** How many positions an allele's name says it differs from its stem allele. */
export function nameDifferences(name: string): number {
  const star = (name ?? '').indexOf('*');
  const cut = (name ?? '').indexOf('_', star >= 0 ? star + 1 : 0);
  return cut < 0 ? 0 : name.slice(cut + 1).split('_').length;
}

/** One name, with no knowledge of its neighbours - use only where a clash is impossible. */
export function shortenAlleleName(name: string, limit = NAME_LIMIT): string {
  if (!name || name.length <= limit) {
    return name;
  }

  // the split is the first _ AFTER the allele: gene names themselves contain
  const star = name.indexOf('*');
  const cut = name.indexOf('_', star >= 0 ? star + 1 : 0);
  if (cut >= 0) {
    const suffix = name.slice(cut + 1);
    // the count alone is not distinguishing enough: of the 793 names
    return `${name.slice(0, cut)}+${suffix.split('_').length}~${suffixToken(suffix)}`;
  }
  return `${name.slice(0, limit - 1)}~`;
}

/** Display labels for a group of alleles, guaranteed unique within the group. */
export function shortenAlleleNames(names: string[], limit = NAME_LIMIT): Map<string, string> {
  const used = new Set<string>();
  const display = new Map<string, string>();

  // Sorted, so a `#2` lands on the same allele here as it does server-side.
  for (const name of [...names].sort()) {
    const label = shortenAlleleName(name, limit);
    let candidate = label;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${label}#${n}`;
      n += 1;
    }
    used.add(candidate);
    display.set(name, candidate);
  }
  return display;
}

/** An ASC written as a gene name, for display only. */
export function ascDisplayName(locus: string | undefined, asc: string | undefined): string {
  if (!asc) {
    return '';
  }
  if (!locus) {
    return asc;
  }
  return asc.toUpperCase().startsWith(locus.toUpperCase()) ? asc : `${locus}${asc}`;
}
