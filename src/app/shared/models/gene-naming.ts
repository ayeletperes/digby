/**
 * Reading structure out of an ASC name.
 *
 * The dashboards narrow a locus by segment and group it by family, and both are
 * derived from the name: there is no separate field for either in the refbook API.
 */

export const SEGMENT_ORDER = ['V', 'D', 'J', 'C'];

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
 * A short display label for a long allele name.
 *
 * VDJbase encodes every SNP of a novel allele in its name, which reaches 193
 * characters here. Axis ticks and set labels cannot show that, so a long name is
 * reduced to its stem plus the number of substitutions it carried:
 * IGHV1-2*02_t211c_t213c_g225a becomes IGHV1-2*02+3. The full name stays available
 * for tooltips.
 */
export function shortenAlleleName(name: string, limit = 20): string {
  if (!name || name.length <= limit) {
    return name;
  }

  const [stem, ...suffixes] = name.split('_');
  if (suffixes.length) {
    return `${stem}+${suffixes.length}`;
  }
  return `${name.slice(0, limit - 1)}~`;
}
