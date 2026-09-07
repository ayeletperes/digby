import { Type } from '@angular/core';
import { DataSource, SourceAvailability } from '../shared/models/species-gene-selection.model';

/** One tab of the reference dashboard. */
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
  /** Databases this panel needs. */
  requires: DataSource[];
  /** True if the panel plots several genes at once. */
  multi: boolean;
  /** True if the panel describes one allele and needs one selected. */
  needsAllele?: boolean;
  load: () => Promise<Type<unknown>>;
}

/** Panel groups, in the order the rail lists them. */
export const PANEL_GROUPS = ['Locus', 'Reference', 'Detail'];

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
    id: 'sunburst',
    group: 'Locus',
    label: 'Locus map',
    description: 'The whole locus at once: gene type, subgroup, gene and allele as nested rings.',
    caption: 'Every allele in the locus, one ring per level: chain, gene type, subgroup, ' +
             'gene, allele, from the centre out. An arc is as wide as the number of alleles ' +
             'beneath it. Click a ring to drill in, click it again to step back out, click an ' +
             'allele to open it. Colour marks where you are, not what the data says. This is ' +
             'the reference content of the whole locus: every allele either database ' +
             'holds, whichever filters are set. Drilled to a gene, it offers a way ' +
             'to go on and explore that gene in the gene-level panels.',
    requires: [],
    multi: true,
    load: () => import('./dash-refbook-sunburst/dash-refbook-sunburst.component')
      .then(m => m.DashRefbookSunburstComponent),
  },
  {
    id: 'names',
    group: 'Reference',
    label: 'Allele names',
    description: 'What the shortened labels in the plots stand for.',
    caption: 'Allele names carrying many substitutions are too long for a chart axis, so ' +
             'the plots collapse the suffix to a count and a token: IGHV1-18*04+8~i93 is ' +
             'the allele that differs from IGHV1-18*04 at eight positions, and the token ' +
             'is derived from those positions so the label does not change as more alleles ' +
             'are loaded. Where two alleles would still shorten alike the second is marked ' +
             '#2, so a shortened label always identifies exactly one allele, and this panel ' +
             'is what resolves it.',
    requires: [],
    multi: false,
    load: () => import('./dash-refbook-names/dash-refbook-names.component')
      .then(m => m.DashRefbookNamesComponent),
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
    // the id is in the URL, so it stays 'tree' even though the panel is not one
    id: 'tree',
    group: 'Reference',
    label: 'Group clustering',
    description: 'Which alleles of the gene group together by sequence.',
    caption: 'Groups the alleles of the gene by how much their sequences differ. V alleles ' +
             'are stored IMGT-gapped, so the columns correspond and the distance counts the ' +
             'positions that differ. D and J have no gapped form and differ in length, so ' +
             'each pair is aligned end to end and the distance counts inserted and deleted ' +
             'bases too; the note under the figure says which was used. Two groups join at ' +
             'the distance of their furthest pair, so where a join sits is that distance, ' +
             'not each allele\'s distance to the rest. Alleles identical over the compared ' +
             'positions are listed together rather than drawn twice. This groups by ' +
             'similarity and says nothing about ancestry: sequences that differ by one ' +
             'position group closely whether or not they are related that way.',
    requires: [],
    multi: false,
    load: () => import('./dash-refbook-tree/dash-refbook-tree.component')
      .then(m => m.DashRefbookTreeComponent),
  },
  {
    id: 'usage',
    group: 'Reference',
    label: 'Allele Usage',
    description: 'Usage of each allele across samples. Needs AIRR-seq data.',
    // describes what is plotted, and stops there - what a narrow box means is
    caption: 'Relative usage of each allele: the fraction of a sample\'s rearrangements ' +
             'assigned to it. Each box is one allele, each point one sample. A sample in ' +
             'which the allele was not detected contributes no point.',
    requires: ['airrseq'],
    multi: false,
    load: () => import('./dash-refbook-usage/dash-refbook-usage.component')
      .then(m => m.DashRefbookUsageComponent),
  },
  {
    id: 'zygosity',
    group: 'Reference',
    label: 'Zygosity',
    description: 'Which alleles occur together in a subject, from either database.',
    caption: 'Which combinations of alleles occur together in the same subject. Each column is ' +
             'a combination, its bar the number of samples carrying exactly that set, and the ' +
             'dots below show which alleles are in it. The bars on the left are how often each ' +
             'allele appears overall, regardless of what it appears with.',
    // Zygosity is which alleles a subject carries, which genomic reports too.
    requires: [],
    multi: false,
    load: () => import('./dash-refbook-zygosity/dash-refbook-zygosity.component')
      .then(m => m.DashRefbookZygosityComponent),
  },
];

/** Why a panel cannot run, or null when it can. */
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
      return `Needs ${name} data. Enable it in the rail.`;
    }
  }

  if (!panel.multi && !ascCount) {
    return 'Select a gene to see this panel.';
  }

  return null;
}
