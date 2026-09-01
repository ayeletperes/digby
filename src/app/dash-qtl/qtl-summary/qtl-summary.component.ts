import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY, forkJoin } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { ascDisplayName } from '../../shared/models/gene-naming';
import { ExportTable, exportButtons } from '../../shared/plot-export/plot-export';

/**
 * Where the significant variants are, across the whole run.
 *
 * The Manhattan answers this one scan at a time. This answers it for everything
 * at once: how many variants reached significance, in which segment's genes, and
 * what they sit in - a coding change, a leader, an RSS, a UTR, or intergenic
 * sequence.
 *
 * Two levels, because "for gene and their locations" can mean either. The locus
 * chart is the run in one picture. The gene table below is the same counts split
 * per gene, which is the question the chart cannot answer and the printed figure
 * had no room for.
 *
 * COUNTING. The locus chart counts distinct variants, so a variant significant
 * for six V genes is one V variant. Segment bars therefore need not sum to the
 * locus total - a variant significant against both a V and a J counts under
 * both - and the caption says so rather than leaving a reader to discover it.
 * The gene table counts each gene's own variants, which do sum.
 */

/** Location classes, coloured as the manuscript figure colours them. */
const FEATURE_COLOUR: Record<string, string> = {
  coding: '#3b78c3',
  leader: '#e8a33d',
  rss: '#35a67c',
  intergenic: '#8b6bb1',
};

/**
 * Location classes folded together for display.
 *
 * The manuscript figure counts UTR variants as intergenic, and this panel is
 * read against that figure, so it does the same. Folded here and not in the
 * database or the endpoint, both of which keep the classes apart: this is a
 * choice about presentation, and it is reversible by deleting a line rather
 * than by rebuilding anything. The counts involved are small and named in the
 * panel's own note, so the fold is stated rather than silent.
 */
const FOLD_INTO: Record<string, string> = { utr: 'intergenic' };

const fold = (feature: string): string => FOLD_INTO[feature] ?? feature;

@Component({
  selector: 'app-qtl-summary',
  templateUrl: './qtl-summary.component.html',
  styleUrls: ['./qtl-summary.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, PlotlyModule],
})
export class QtlSummaryComponent implements OnChanges {
  @Input() species?: string;
  @Input() locus?: string;

  /** Open a gene's own scan, which is what a row of the table is asking about. */
  @Output() genePicked = new EventEmitter<{ locus: string; asc: string }>();
  /** Open a variant, from a gene's strongest hit. */
  @Output() variantPicked = new EventEmitter<{ locus: string; variant: string }>();

  loading = false;
  error: string | null = null;

  summary: any = null;
  genes: any = null;

  /** Counts span four orders of magnitude, so a linear axis hides the small bars. */
  logScale = true;

  /**
   * Just this locus, or all of them.
   *
   * The selected locus by default: it is the one every other panel is showing,
   * and a chart that silently answers about three loci at once invites reading a
   * number off the wrong group. All-loci is one click away because the
   * comparison is the whole point of the printed version.
   */
  allLoci = false;

  /**
   * How the counting works, behind the same info control the rest of the site
   * uses. It is a rule that is read once and then only in the way. The
   * denominators do not go with it: a count without what it was drawn from is
   * the thing the note is warning about.
   */
  infoOpen = false;
  geneInfoOpen = false;

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};
  /**
   * Its own table, not the traces.
   *
   * With more than one locus the x axis is multicategory, so a trace's `x` is
   * two parallel arrays rather than one per bar - the generic reader would
   * flatten that into nonsense. Building the table from the rows the endpoint
   * returned also lets the denominator travel with the count, which a bar
   * height cannot carry.
   */
  readonly plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `guqtl_significant_by_location_${this.allLoci ? 'all_loci' : this.locus}`,
      title: 'Significant gene-usage variants by locus, segment and where they sit'
             + '. Distinct variants, so a variant significant for several genes of'
             + ' one segment counts once',
      source: `/api/qtl/usage_summary/${this.species}`,
      table: this.exportTable,
    })),
  };

  /** The chart's rows, each with the locus total it was drawn from. */
  get exportTable(): ExportTable {
    const shown = this.shownLoci;
    const rows = this.foldedRows
      .filter((r: any) => shown.includes(r.locus))
      .sort((a: any, b: any) => shown.indexOf(a.locus) - shown.indexOf(b.locus)
                             || a.segment.localeCompare(b.segment)
                             || b.n - a.n)
      .map((r: any) => [r.locus, r.segment, r.feature, r.n,
                        this.summary.totals[r.locus]?.n_significant ?? '',
                        this.summary.totals[r.locus]?.n_variants ?? '']);
    return {
      columns: ['locus', 'segment', 'location', 'significant_variants',
                'locus_significant_total', 'locus_variants_tested'],
      rows,
    };
  }

  readonly ascName = ascDisplayName;

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['species'] || changes['locus']) {
      this.load();
    }
  }

  /** The location classes as shown, after folding. */
  get features(): string[] {
    const seen: string[] = [];
    for (const f of (this.summary?.features ?? []) as string[]) {
      const shown = fold(f);
      if (!seen.includes(shown)) {
        seen.push(shown);
      }
    }
    return seen;
  }

  /** `summary.rows` with the folded classes summed, which is what is drawn. */
  get foldedRows(): any[] {
    const merged = new Map<string, any>();
    for (const r of (this.summary?.rows ?? []) as any[]) {
      const key = `${r.locus}\u0000${r.segment}\u0000${fold(r.feature)}`;
      const at = merged.get(key);
      if (at) {
        at.n += r.n;
      } else {
        merged.set(key, { ...r, feature: fold(r.feature) });
      }
    }
    return [...merged.values()];
  }

  /** A gene's counts with the folded classes summed. */
  countFor(gene: any, feature: string): number {
    return Object.entries(gene.by_feature ?? {})
      .filter(([f]) => fold(f) === feature)
      .reduce((sum, [, n]) => sum + (n as number), 0);
  }

  colourOf(feature: string): string {
    return FEATURE_COLOUR[feature] ?? '#b0bebd';
  }

  toggleScale(): void {
    this.logScale = !this.logScale;
    this.draw();
  }

  toggleInfo(): void {
    this.infoOpen = !this.infoOpen;
  }

  toggleGeneInfo(): void {
    this.geneInfoOpen = !this.geneInfoOpen;
  }

  toggleScope(): void {
    this.allLoci = !this.allLoci;
    this.draw();
  }

  /** The loci the chart is drawing. */
  get shownLoci(): string[] {
    const all: string[] = this.summary?.loci ?? [];
    return this.allLoci || !this.locus ? all : all.filter(l => l === this.locus);
  }

  /** Genes worth listing first: the ones that actually have a signal. */
  get rankedGenes(): any[] {
    return this.genes?.genes ?? [];
  }

  // ------------------------------------------------------------- table filter
  geneSegment = '';
  geneFilter = '';
  /**
   * Off by default. A table of only the genes that hit reads as though the rest
   * were never looked at, which is the opposite of what this panel is for, so
   * hiding them has to be asked for.
   */
  withSignalOnly = false;

  /** Segments this locus actually scanned. IGH has three, the light chains two. */
  get geneSegments(): string[] {
    const order = ['V', 'D', 'J', 'C'];
    const present = new Set<string>(this.rankedGenes.map(g => g.segment));
    return order.filter(x => present.has(x))
      .concat([...present].filter(x => !order.includes(x)).sort());
  }

  /**
   * The table after its filters.
   *
   * Matched against the name as stored and as displayed, so someone typing
   * "IGHV3" and someone typing "V3" find the same genes.
   */
  get shownGenes(): any[] {
    const q = this.geneFilter.trim().toUpperCase();
    return this.rankedGenes.filter(g =>
      (!this.geneSegment || g.segment === this.geneSegment)
      && (!this.withSignalOnly || g.n_significant > 0)
      && (!q || String(g.asc).toUpperCase().includes(q)
             || ascDisplayName(this.locus, g.asc).toUpperCase().includes(q)));
  }

  toggleGeneSegment(segment: string): void {
    this.geneSegment = this.geneSegment === segment ? '' : segment;
  }

  get geneFiltersOn(): boolean {
    return !!this.geneSegment || !!this.geneFilter.trim() || this.withSignalOnly;
  }

  clearGeneFilters(): void {
    this.geneSegment = '';
    this.geneFilter = '';
    this.withSignalOnly = false;
  }

  /** The share of a locus's significant variants that are not intergenic. */
  get inFeatureShare(): { n: number; total: number } | null {
    if (!this.summary) {
      return null;
    }
    const rows = this.foldedRows.filter((r: any) => this.shownLoci.includes(r.locus));
    const total = rows.reduce((s: number, r: any) => s + r.n, 0);
    const inFeature = rows.filter((r: any) => r.feature !== 'intergenic')
                          .reduce((s: number, r: any) => s + r.n, 0);
    return total ? { n: inFeature, total } : null;
  }

  private load(): void {
    if (!this.species) {
      return;
    }
    this.loading = true;
    this.error = null;
    this.clearGeneFilters();

    forkJoin({
      summary: this.qtl.usageSummary(this.species),
      genes: this.locus ? this.qtl.geneSummary(this.species, this.locus)
                        : EMPTY.pipe(catchError(() => EMPTY)),
    }).pipe(catchError(err => {
      this.error = err?.error?.message ?? 'Could not load the summary';
      this.loading = false;
      return EMPTY;
    })).subscribe(result => {
      this.loading = false;
      this.summary = result.summary;
      this.genes = result.genes ?? null;
      this.draw();
    });
  }

  /**
   * One bar per (locus, segment, location class).
   *
   * A two-level x axis rather than three separate charts: the loci are being
   * compared, and separate panels with separate axes would invite reading their
   * heights against each other when the axes differ.
   */
  private draw(): void {
    if (!this.summary) {
      this.plotData = [];
      return;
    }

    const loci: string[] = this.shownLoci;
    const segments: string[] = this.summary.segments;
    const folded = this.foldedRows;
    // only the (locus, segment) pairs that were actually scanned; a column for
    // IGK D would say the D genes came up empty rather than that IGK has none
    const columns: [string, string][] = [];
    for (const locus of loci) {
      for (const segment of segments) {
        if (folded.some((r: any) => r.locus === locus && r.segment === segment)) {
          columns.push([locus, segment]);
        }
      }
    }

    // A two-level axis only when there are two levels. Plotly draws group
    // dividers for a multicategory axis - vertical rules hanging below the plot
    // into the margin - and with a single locus they divide nothing and read as
    // stray lines dropping off the chart.
    const grouped = loci.length > 1;

    this.plotData = this.features.map(feature => {
      const values = columns.map(([locus, segment]) =>
        folded.find((r: any) => r.locus === locus && r.segment === segment
                                && r.feature === feature)?.n ?? null);
      return {
        type: 'bar',
        name: feature,
        x: grouped ? [columns.map(c => c[0]), columns.map(c => c[1])]
                   : columns.map(c => c[1]),
        y: values,
        text: values.map(v => v === null ? '' : String(v)),
        textposition: 'outside',
        textfont: { size: 9 },
        cliponaxis: false,
        marker: { color: this.colourOf(feature) },
        hovertemplate: `%{x}<br>${feature}: %{y} significant variants<extra></extra>`,
      };
    });

    this.plotLayout = {
      height: 380,
      margin: { l: 70, r: 12, t: 26, b: 60 },
      barmode: 'group',
      // Plotly 3 drops a plain string title silently and draws nothing
      xaxis: grouped
        ? { type: 'multicategory', title: { text: 'Locus and segment' } }
        : { type: 'category', title: { text: loci[0] ?? 'Segment' } },
      // `rangemode: 'tozero'` only means something on a linear axis. On a log one
      // zero is at minus infinity, so asking the range to include it is asking
      // for a range with no bottom; Plotly currently ignores it and autoranges,
      // but the combination is undefined and not something to leave sitting in a
      // layout that is rebuilt on every toggle and resize.
      yaxis: this.logScale
        ? { title: { text: 'Significant variants (log scale)' }, type: 'log' }
        : { title: { text: 'Significant variants' }, type: 'linear',
            rangemode: 'tozero' },
      legend: { orientation: 'h', y: 1.14, x: 0, title: { text: '' } },
    };
  }
}
