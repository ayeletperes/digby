import { Type } from '@angular/core';
import { DataSource, SourceAvailability } from '../shared/models/species-gene-selection.model';

/**
 * One tab of the reference dashboard.
 *
 * Adding a panel is a component plus an entry in DASH_PANELS below. The tab list,
 * its ordering and its enabled state are all derived from this, so nothing else
 * needs editing.
 */
export interface DashPanel {
  /** Stable identifier. Appears in the URL, so do not rename casually. */
  id: string;
  label: string;
  /** Heading this panel is listed under in the rail. */
  group: string;
  /** Short line shown when the panel is unavailable, and as the tab tooltip. */
  description: string;
  /** What the plot actually shows, revealed by the info control above it. */
  caption: string;
  /**
   * Databases this panel needs. A panel requiring 'airrseq' cannot run on a
   * genomic-only selection. Empty means it works from whatever is available.
   */
  requires: DataSource[];
  /** True if the panel plots several genes at once. */
  multi: boolean;
  /** True if the panel describes one allele and needs one selected. */
  needsAllele?: boolean;
  load: () => Promise<Type<unknown>>;
}

/** Panel groups, in the order the rail lists them. */
export const PANEL_GROUPS = ['Reference', 'Detail'];

export const DASH_PANELS: DashPanel[] = [
  {
    id: 'allele',
    group: 'Detail',
    label: 'Allele',
    description: 'Everything known about one allele. Opened by clicking an allele in any plot.',
    caption: 'The level below the gene. Where the allele was seen (genomic, AIRR-seq or both), ' +
             'how much of a repertoire it typically accounts for, how many subjects carry it and ' +
             'in which projects, which other alleles of the gene it turns up alongside, and its ' +
             'sequence against the gene reference. The gene-level panels stay as they were, so ' +
             'stepping back up is one click.',
    requires: [],
    multi: false,
    needsAllele: true,
    load: () => import('./dash-refbook-allele/dash-refbook-allele.component')
      .then(m => m.DashRefbookAlleleComponent),
  },
  {
    id: 'overview',
    group: 'Reference',
    label: 'Overview',
    description: 'Allele counts for the selected gene, split by the database they came from.',
    caption: 'Counts every allele recorded for the gene, and how many samples each was seen ' +
             'in. One bar per database, side by side: an allele found in both has two bars, ' +
             'and their heights can differ because the databases hold different samples. ' +
             'A database you have not selected is omitted rather than drawn empty. Novel ' +
             'alleles are those not in the baseline reference set.',
    requires: [],
    multi: false,
    load: () => import('./dash-refbook-overview/dash-refbook-overview.component')
      .then(m => m.DashRefbookOverviewComponent),
  },
  {
    id: 'alignment',
    group: 'Reference',
    label: 'Alignment',
    description: 'Codon-numbered alignment of every allele against the first, with CDR regions marked.',
    caption: 'Aligns every allele of the gene against the first one alphabetically, which acts ' +
             'as the reference row. Dashes mean the codon matches the reference, lower-case ' +
             'letters mark a substitution, and dots are IMGT alignment gaps. Numbers above the ' +
             'rows are codon positions and, for V genes, the CDR regions are marked. ' +
             'Drilling into a single allele keeps the gene\'s first allele as the reference, ' +
             'since a lone sequence has nothing to be compared against.',
    requires: [],
    multi: false,
    load: () => import('./dash-refbook-alignment/dash-refbook-alignment.component')
      .then(m => m.DashRefbookAlignmentComponent),
  },
  {
    id: 'usage',
    group: 'Reference',
    label: 'Allele Usage',
    description: 'Usage of each allele across samples. Needs AIRR-seq data.',
    caption: 'For each allele, the distribution across samples of how much of that sample\'s ' +
             'repertoire it accounts for. Each box is one allele; each point is one sample. ' +
             'Only samples in which the allele was detected contribute a point, so a narrow ' +
             'box can mean a consistent allele or simply a rare one.',
    requires: ['airrseq'],
    multi: false,
    load: () => import('./dash-refbook-usage/dash-refbook-usage.component')
      .then(m => m.DashRefbookUsageComponent),
  },
  {
    id: 'zygosity',
    group: 'Reference',
    label: 'Zygosity',
    description: 'Which alleles occur together in a subject. Needs AIRR-seq data.',
    caption: 'Which combinations of alleles occur together in the same subject. Each column is ' +
             'a combination, its bar the number of samples carrying exactly that set, and the ' +
             'dots below show which alleles are in it. The bars on the left are how often each ' +
             'allele appears overall, regardless of what it appears with.',
    requires: ['airrseq'],
    multi: false,
    load: () => import('./dash-refbook-zygosity/dash-refbook-zygosity.component')
      .then(m => m.DashRefbookZygosityComponent),
  },
];

/**
 * Why a panel cannot run, or null when it can.
 *
 * Distinguishes "this locus has no such data" from "you chose not to include it",
 * because the two need different things from the user.
 */
export function panelBlockedReason(
  panel: DashPanel,
  selected: DataSource[],
  available: SourceAvailability,
  ascCount: number,
  alleleCount = 0,
): string | null {
  if (panel.needsAllele && !alleleCount) {
    return 'Click an allele in any plot to open it here.';
  }

  const has: Record<DataSource, boolean> = {
    genomic: available.genomic,
    airrseq: available.airrseq,
  };

  for (const source of panel.requires) {
    const name = source === 'airrseq' ? 'AIRR-seq' : 'genomic';
    if (!has[source]) {
      return `This locus has no ${name} data.`;
    }
    if (!selected.includes(source)) {
      return `Needs ${name} data — enable it above.`;
    }
  }

  if (!ascCount) {
    return 'Select a gene to see this panel.';
  }

  return null;
}
