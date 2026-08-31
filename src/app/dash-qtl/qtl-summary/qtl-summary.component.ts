import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY, forkJoin } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { ascDisplayName } from '../../shared/models/gene-naming';

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
  utr: '#9aa6a5',
  intergenic: '#8b6bb1',
};

@Component({
  selector: 'app-qtl-summary',
  templateUrl: './qtl-summary.component.html',
  styleUrls: ['./qtl-summary.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule],
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

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};
  readonly plotConfig = { responsive: true, displaylogo: false };

  readonly ascName = ascDisplayName;

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['species'] || changes['locus']) {
      this.load();
    }
  }

  get features(): string[] {
    return this.summary?.features ?? [];
  }

  colourOf(feature: string): string {
    return FEATURE_COLOUR[feature] ?? '#b0bebd';
  }

  toggleScale(): void {
    this.logScale = !this.logScale;
    this.draw();
  }

  /** Genes worth listing first: the ones that actually have a signal. */
  get rankedGenes(): any[] {
    return this.genes?.genes ?? [];
  }

  countFor(gene: any, feature: string): number {
    return gene.by_feature?.[feature] ?? 0;
  }

  /** The share of a locus's significant variants that are not intergenic. */
  get inFeatureShare(): { n: number; total: number } | null {
    if (!this.summary) {
      return null;
    }
    const rows = this.summary.rows.filter((r: any) => r.locus === this.locus);
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

    const loci: string[] = this.summary.loci;
    const segments: string[] = this.summary.segments;
    // only the (locus, segment) pairs that were actually scanned; a column for
    // IGK D would say the D genes came up empty rather than that IGK has none
    const columns: [string, string][] = [];
    for (const locus of loci) {
      for (const segment of segments) {
        if (this.summary.rows.some((r: any) => r.locus === locus && r.segment === segment)) {
          columns.push([locus, segment]);
        }
      }
    }

    this.plotData = this.features.map(feature => {
      const values = columns.map(([locus, segment]) =>
        this.summary.rows.find((r: any) => r.locus === locus && r.segment === segment
                                        && r.feature === feature)?.n ?? null);
      return {
        type: 'bar',
        name: feature,
        x: [columns.map(c => c[0]), columns.map(c => c[1])],
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
      xaxis: { type: 'multicategory', title: { text: 'Locus and segment' } },
      yaxis: {
        title: { text: this.logScale ? 'Significant variants (log scale)'
                                     : 'Significant variants' },
        type: this.logScale ? 'log' : 'linear',
        rangemode: 'tozero',
      },
      legend: { orientation: 'h', y: 1.14, x: 0, title: { text: '' } },
    };
  }
}
