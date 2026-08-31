import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { QtlRegionComponent } from '../qtl-region/qtl-region.component';
import { ascDisplayName } from '../../shared/models/gene-naming';
import { exportButtons } from '../../shared/plot-export/plot-export';
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
  imports: [CommonModule, PlotlyModule, QtlRegionComponent],
})
export class QtlVariantComponent implements OnChanges {
  @Input() selection: QtlSelection;
  /** The ASC the clicked point came from, when the scan was a whole-locus one. */
  @Input() fallbackAsc?: string;

  @Output() ascPicked = new EventEmitter<string>();
  /** A neighbour in the region track, handed up so the shell can re-select it. */
  @Output() regionVariantPicked = new EventEmitter<string>();
  /** The way back to the scan this variant was opened from. */
  @Output() backToGene = new EventEmitter<void>();

  readonly ascName = ascDisplayName;

  /**
   * The table used to stop at the strongest 12 of however many genes there are.
   *
   * A silent cap, and a misleading one: the heading says every gene, and with 70
   * genes in IGH it showed a sixth of them with no indication there was a rest.
   * Every row is drawn now, inside a scroll box, with the counts said out loud.
   */
  significantOnly = false;

  get significantCount(): number {
    return this.associations.filter(a => a.significant).length;
  }

  get shownAssociations(): QtlAssociation[] {
    return this.significantOnly
      ? this.associations.filter(a => a.significant) : this.associations;
  }

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
  /**
   * The usage boxplot exports its own points: the traces hold one usage value
   * per subject, which is the data and not a summary of it. The stats that
   * qualify the whole figure - effect, p, and the smallest genotype class -
   * ride in the title, so a downloaded table cannot be read without them.
   */
  readonly plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.variant?.variant}_${this.plottedAsc}_usage`,
      title: `Usage of ${this.plottedAsc} by ${this.variant?.variant} genotype`
        + (this.association
            ? ` — effect ${this.association.beta.toFixed(3)},`
              + ` p ${this.association.p_value.toExponential(2)},`
              + ` n ${this.association.n}`
              + (this.association.min_genotype_group !== null
                  ? `, smallest genotype class ${this.association.min_genotype_group}`
                    + (this.association.well_powered === false ? ' (not well powered)' : '')
                  : '')
            : ''),
      source: `/api/qtl/variant_usage/${this.selection?.species}/${this.selection?.locus}`
              + `/${this.variant?.variant}?asc=${this.plottedAsc}`,
      data: this.plotData, layout: this.plotLayout,
    })),
  };

  /** The genotype counts are a second figure and export themselves. */
  readonly countsConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.variant?.variant}_genotype_counts`,
      title: `Subjects carrying each ${this.variant?.variant} genotype`,
      source: `/api/qtl/variant/${this.selection?.species}/${this.selection?.locus}`
              + `/${this.variant?.variant}`,
      data: this.countsPlot, layout: this.countsLayout,
    })),
  };

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
      xaxis: { title: { text: 'Genotype' }, automargin: true },
      yaxis: { title: { text: `Gene usage of ${this.plottedAsc ?? ''}` }, tickformat: '.1%',
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
      xaxis: { title: { text: 'Genotype' }, automargin: true },
      yaxis: { title: { text: 'Subjects' }, rangemode: 'tozero', automargin: true },
    };
  }
}
