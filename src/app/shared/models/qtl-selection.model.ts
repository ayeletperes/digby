/**
 * What the guQTL dashboard is currently looking at.
 *
 * A separate model from SpeciesGeneSelection on purpose. The reference dashboard
 * selects on species/locus/segment/gene/allele across two databases; this one
 * selects on species/locus/ASC/variant within a single association run, and its
 * cohort is a different one - Watson subject ids, not VDJbase samples. Sharing a
 * model would leave half of each irrelevant.
 */
export interface QtlSelection {
  species?: string;
  locus?: string;

  /**
   * The study whose cohort was scanned.
   *
   * One project at a time: a scan is computed within a cohort and never pooled
   * across them, so this chooses which database answers rather than filtering
   * inside one. Absent while only one project is loaded, which is the state the
   * backend serves without being asked.
   */
  project?: string;

  /** The ASC whose usage is being explained. Absent means the whole-locus view. */
  asc?: string;

  /** The variant being examined, set by clicking a Manhattan point. */
  variant?: string;

  /** Subject subsets to restrict to, for the recomputed views. */
  ancestry?: string[];
}

export interface QtlAsc {
  asc: string;
  segment: string;
  n_member: number | null;
  n_variants: number;
  n_significant: number;
  best_neglog10_p: number;
}

export interface QtlThreshold {
  analysis: string;
  conditional: string | null;
  grouped_by: string | null;
  threshold: number;
  neglog10_threshold: number | null;
  n_subjects: number | null;
  n_variants: number | null;
  n_independent: number | null;
  n_asc: number | null;
  n_significant_variants: number | null;
}

export interface QtlPoint {
  variant: string;
  /** The ASC whose scan produced this point. */
  asc?: string;
  pos: number | null;
  maf: number | null;
  gene: string | null;
  feature: string | null;
  neglog10_p: number;
  significant: boolean;
}

export interface QtlLead {
  variant: string;
  pos: number | null;
  asc: string;
  neglog10_p: number;
  beta: number | null;
  min_genotype_group: number | null;
  well_powered: boolean | null;
}

export interface QtlAssociation {
  asc: string;
  segment: string;
  beta: number | null;
  se: number | null;
  p_value: number;
  neglog10_p: number;
  significant: boolean;
  n: number | null;
  min_genotype_group: number | null;
  well_powered: boolean | null;
  is_lead: boolean;
}

/** The usage threshold, which is the one the Manhattan line is drawn at. */
export function usageThreshold(thresholds: QtlThreshold[]): QtlThreshold | undefined {
  return (thresholds ?? []).find(t => t.analysis === 'usage');
}

/** A tested variant and where it sits. */
export interface QtlVariant {
  variant: string;
  contig: string | null;
  pos: number | null;
  maf: number | null;
  gene: string | null;
  feature: string | null;
  sub_feature: string | null;
  distance_to_gene: number | null;
}

/**
 * What a bare variant id resolves to.
 *
 * `locus` is part of the answer rather than part of the question: someone
 * arriving with an id from a GWAS hit does not know which locus holds it.
 */
export interface QtlVariantLookup {
  locus: string;
  variant: QtlVariant;
  associations: QtlAssociation[];
  /** Every ASC in the locus is scanned against every variant. */
  n_tested: number;
  n_significant: number;
  /** Subjects per genotype class, keyed 0/1/2. A property of the variant. */
  genotype_counts: Record<string, number>;
  /** The rarest genotype class, which qualifies every p-value in the table. */
  min_genotype_group: number | null;
  thresholds: QtlThreshold[];
  has_genotypes: boolean;
}

/** The fit behind one boxplot. */
export interface QtlFit {
  beta: number | null;
  se: number | null;
  p_value: number;
  neglog10_p: number;
  n: number | null;
  significant: boolean;
  min_genotype_group: number | null;
  well_powered: boolean | null;
}
