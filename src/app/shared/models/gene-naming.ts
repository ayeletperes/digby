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
export const NAME_LIMIT = 26;

/** One name, with no knowledge of its neighbours - use only where a clash is impossible. */
export function shortenAlleleName(name: string, limit = NAME_LIMIT): string {
  if (!name || name.length <= limit) {
    return name;
  }

  // the split is the first _ AFTER the allele: gene names themselves contain
  // underscores (IGHV4-NL_1*01_a157g), and splitting on the first one dropped
  // the allele and miscounted the mutations
  const star = name.indexOf('*');
  const cut = name.indexOf('_', star >= 0 ? star + 1 : 0);
  if (cut >= 0) {
    return `${name.slice(0, cut)}+${name.slice(cut + 1).split('_').length}`;
  }
  return `${name.slice(0, limit - 1)}~`;
}

/**
 * Display labels for a group of alleles, guaranteed unique within the group.
 *
 * Two alleles sharing a stem and a mutation count shorten to the same label -
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
