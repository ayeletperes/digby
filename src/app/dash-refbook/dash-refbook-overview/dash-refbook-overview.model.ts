export class OverviewData {
  total: number;
  novel: number;
  baseline: number;
  alleles: string[];
  genomic_only_counts: number[];
  vdjbase_only_counts: number[];
  both_counts: number[];
  genomic_counts?: number[];
  vdjbase_counts?: number[];
  /**
   * How many samples the figures are drawn from, and how many are the same
   * sample in both databases.
   *
   * `shared` is what makes Both meaningful: the rhesus macaque data is one
   * cohort sequenced both ways (106 of 106 names match), so an allele can be
   * seen in the same animal by both. The human databases hold disjoint cohorts,
   * where Both is necessarily zero and the chart should say so rather than draw
   * an empty series.
   */
  cohort?: { genomic: number; airrseq: number; shared: number };
}
