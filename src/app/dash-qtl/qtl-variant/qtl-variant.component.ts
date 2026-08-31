import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import {
  QtlAssociation, QtlFit, QtlSelection, QtlVariant,
} from '../../shared/models/qtl-selection.model';

interface SubjectPoint {
  subject: string;
  genotype: number | null;
  usage: number | null;
}

/** Genotype classes, written the way the genotype is actually reported. */
const GENOTYPE_LABEL: Record<number, string> = { 0: '0/0', 1: '0/1', 2: '1/1' };
const GENOTYPE_COLOUR: Record<number, string> = { 0: '#2a78d6', 1: '#e34948', 2: '#eda100' };

/**
 * What one variant does to one gene's usage.
 *
 * This is the plot behind a Manhattan point. The scan says a variant explains
 * usage of an ASC; this shows the usage it explains, one point per subject,
 * grouped by how many copies of the variant that subject carries.
 */
@Component({
  selector: 'app-qtl-variant',
  templateUrl: './qtl-variant.component.html',
  styleUrls: ['./qtl-variant.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule],
})
export class QtlVariantComponent implements OnChanges {
  @Input() selection: QtlSelection;
  /** The ASC the clicked point came from, when the scan was a whole-locus one. */
  @Input() fallbackAsc?: string;

  @Output() ascPicked = new EventEmitter<string>();

  isFetching = false;
  error: string | null = null;

  variant: QtlVariant | null = null;
  associations: QtlAssociation[] = [];
  subjects: SubjectPoint[] = [];
  association: QtlFit | null = null;
  hasGenotypes = false;

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};

  /** Group sizes, shown beside the boxes: a class of five is not a distribution. */
  countsPlot: unknown[] = [];
  countsLayout: Record<string, unknown> = {};
  readonly plotConfig = { responsive: true, displaylogo: false };

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selection'] || changes['fallbackAsc']) {
      this.fetch();
    }
  }

  /** The ASC being plotted: the chosen one, else the one the point came from. */
  get plottedAsc(): string | undefined {
    return this.selection?.asc ?? this.fallbackAsc;
  }

  get counts(): { genotype: number; label: string; n: number }[] {
    return [0, 1, 2].map(genotype => ({
      genotype,
      label: GENOTYPE_LABEL[genotype],
      n: this.subjects.filter(s => s.genotype === genotype).length,
    })).filter(entry => entry.n > 0);
  }

  private fetch(): void {
    const { species, locus, variant } = this.selection ?? {};
    const asc = this.plottedAsc;

    if (!species || !locus || !variant) {
      this.variant = null;
      return;
    }

    this.isFetching = true;
    this.error = null;

    forkJoin({
      detail: this.qtl.variant(species, locus, variant),
      usage: asc
        ? this.qtl.variantUsage(species, locus, variant, asc)
            .pipe(catchError(() => of({ subjects: [], association: null })))
        : of({ subjects: [], association: null }),
    })
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? err?.message ?? 'Could not load this variant';
        this.isFetching = false;
        return EMPTY;
      }))
      .subscribe(result => {
        this.isFetching = false;
        this.variant = result.detail?.variant ?? null;
        this.associations = result.detail?.associations ?? [];
        this.hasGenotypes = !!result.detail?.has_genotypes;
        this.subjects = result.usage?.subjects ?? [];
        this.association = result.usage?.association ?? null;
        this.build();
      });
  }

  private build(): void {
    // one box per genotype class, points overlaid: with 29 subjects in a class a
    // box alone would imply more confidence than the data carries
    this.plotData = this.counts.map(({ genotype, label }) => {
      const rows = this.subjects.filter(s => s.genotype === genotype);
      return {
        type: 'box',
        name: `${label}  (n=${rows.length})`,
        y: rows.map(s => s.usage),
        text: rows.map(s => s.subject),
        boxpoints: 'all',
        jitter: 0.4,
        pointpos: 0,
        marker: { size: 6, opacity: 0.6, color: GENOTYPE_COLOUR[genotype] },
        line: { color: GENOTYPE_COLOUR[genotype] },
        fillcolor: 'rgba(0,0,0,0)',
        hovertemplate: '%{text}<br>usage %{y:.3%}<extra></extra>',
      };
    });

    this.plotLayout = {
      autosize: true,
      height: 440,
      margin: { l: 64, r: 20, t: 16, b: 44 },
      showlegend: false,
      xaxis: { title: 'Genotype', automargin: true },
      yaxis: { title: `Gene usage of ${this.plottedAsc ?? ''}`, tickformat: '.1%',
               rangemode: 'tozero', automargin: true },
    };

    const counts = this.counts;
    this.countsPlot = [{
      type: 'bar',
      x: counts.map(c => c.label),
      y: counts.map(c => c.n),
      marker: { color: counts.map(c => GENOTYPE_COLOUR[c.genotype]) },
      text: counts.map(c => String(c.n)),
      textposition: 'outside',
      hovertemplate: '%{x}: %{y} subjects<extra></extra>',
    }];
    this.countsLayout = {
      autosize: true,
      height: 440,
      margin: { l: 50, r: 20, t: 24, b: 44 },
      showlegend: false,
      xaxis: { title: 'Genotype', automargin: true },
      yaxis: { title: 'Subjects', rangemode: 'tozero', automargin: true },
    };
  }
}
