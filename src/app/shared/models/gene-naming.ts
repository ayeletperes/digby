/**
 * Reading structure out of an ASC name.
 *
 * The dashboards narrow a locus by segment and group it by family, and both are
 * derived from the name: there is no separate field for either in the refbook API.
 */

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
export function segmentsIn(genes: string[]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const gene of genes) {
    const code = segmentOf(gene);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...SEGMENT_ORDER, '?']
    .filter(code => counts.has(code))
    .map(code => ({ code, count: counts.get(code) }));
}

export function segmentLabel(code: string): string {
  return code === '?' ? 'Other' : code;
}

/**
 * The one allele-label rule for the whole app.
 *
 * VDJbase encodes every SNP of a novel allele in its name, so they reach 193
 * characters against a median of 23. Every panel therefore shortens them, and
 * for a while each did it differently: the charts cut at 20 and fell back to the
 * full name on a clash, while the alignment cut at 26 and disambiguated with
 * `#2` - so one allele could be labelled three ways depending where you looked.
 *
 * This mirrors `abbreviate_names` in `api/refbook/refbook.py` exactly. Keep the
 * two in step: the alignment's labels are rendered server-side into the text, so
 * a divergence cannot be fixed on the client.
 *
 * The `#2` form is deliberate rather than falling back to the full name. A
 * fallback would put a 193-character label on a chart axis, which is the problem
 * this exists to solve; the Allele names panel is what resolves a `#2`.
 */
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


/**
 * How many positions an allele's name says it differs from its stem allele.
 *
 * The split is the first _ AFTER the allele, for the same reason the shortener
 * splits there: a gene name can contain underscores. IGHV4-NL_1*01 has no
 * suffix at all and differs at nothing, but splitting on every underscore
 * counts it as one.
 */
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
  // underscores (IGHV4-NL_1*01_a157g), and splitting on the first one dropped
  // the allele and miscounted the substitutions
  const star = name.indexOf('*');
  const cut = name.indexOf('_', star >= 0 ? star + 1 : 0);
  if (cut >= 0) {
    const suffix = name.slice(cut + 1);
    // the count alone is not distinguishing enough: of the 793 names
    // over the limit in the full HUSA set, 231 - 29% - share a stem and a count
    // with another allele. The token is derived from the allele's own suffix, so
    // it never changes when more data is loaded, which a positional #N does.
    return `${name.slice(0, cut)}+${suffix.split('_').length}~${suffixToken(suffix)}`;
  }
  return `${name.slice(0, limit - 1)}~`;
}

/**
 * Display labels for a group of alleles, guaranteed unique within the group.
 *
 * Two alleles sharing a stem and a difference count shorten to the same label -
 * IGHV1-18*01_a157g_a196g and IGHV1-18*01_g276c_c291g both give
 * IGHV1-18*01+2 - and in an UpSet plot the label is the set's identity, so a
 * merge would misstate the data rather than merely confuse.
 */
export function shortenAlleleNames(names: string[], limit = NAME_LIMIT): Map<string, string> {
  const used = new Set<string>();
  const display = new Map<string, string>();

  // Sorted, so a `#2` lands on the same allele here as it does server-side.
  // Assignment depends on iteration order, and the two sides receive their
  // names in different orders.
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

/**
 * An ASC written as a gene name, for display only.
 *
 * ASC names usually drop the locus - IGL's `V9-49` is the gene IGLV9-49 - so the
 * dashboard puts it back when it shows one. IGH's D clusters do not: they are
 * stored as `IGHD5-12`, prefix and all, so prepending the locus again produced
 * `IGHIGHD5-12`. Checked rather than assumed, because the stored string is the
 * identity that every join uses and must not be rewritten to tidy a label.
 */
export function ascDisplayName(locus: string | undefined, asc: string | undefined): string {
  if (!asc) {
    return '';
  }
  if (!locus) {
    return asc;
  }
  return asc.toUpperCase().startsWith(locus.toUpperCase()) ? asc : `${locus}${asc}`;
}
