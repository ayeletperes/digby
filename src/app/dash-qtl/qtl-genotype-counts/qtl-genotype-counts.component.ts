import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlotlyModule } from 'angular-plotly.js';

import { exportButtons } from '../../shared/plot-export/plot-export';

/**
 * How many subjects carry each genotype of a variant.
 *
 * The same three numbers on every panel that shows them, so they are drawn by
 * the same component rather than by three that resemble each other. They had
 * drifted already: three colour lists, three layouts, two of them with a
 * download and one without, and one describing the cohort in words the others
 * did not use.
 *
 * It is the denominator behind every box and every p-value beside it. A genotype
 * class of five subjects is not a distribution however tight its box looks, and
 * this is where a reader finds that out.
 */

const GENOTYPE_LABEL: Record<number, string> = { 0: '0/0', 1: '0/1', 2: '1/1' };
const GENOTYPE_COLOUR: Record<number, string> = { 0: '#2a78d6', 1: '#e34948', 2: '#eda100' };

/** Either shape the endpoints hand back. */
export type GenotypeCounts =
  { genotype: number; n: number }[] | Record<string | number, number> | null | undefined;

@Component({
  selector: 'app-qtl-genotype-counts',
  standalone: true,
  imports: [CommonModule, PlotlyModule],
  template: `
    @if (total) {
      <plotly-plot [data]="plotData" [layout]="plotLayout" [config]="plotConfig"></plotly-plot>
    } @else {
      <p class="none">No genotypes are held for this variant.</p>
    }
  `,
  styles: [`
    .none { margin: 0.4rem 0 0; font-size: 0.78rem; color: var(--vdj-muted, #5f6368); }
  `],
})
export class QtlGenotypeCountsComponent implements OnChanges {
  @Input() counts: GenotypeCounts = null;
  /** Named in the download and its script, so a saved file says what it is. */
  @Input() variant = '';
  @Input() source = '';
  @Input() height = 190;

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};

  readonly plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.variant || 'variant'}_genotype_counts`,
      title: `Subjects carrying each genotype of ${this.variant || 'this variant'}`,
      source: this.source,
      table: { columns: ['genotype', 'subjects'],
               rows: [0, 1, 2].map(g => [GENOTYPE_LABEL[g], this.value(g)]) },
    })),
  };

  /** Both shapes normalise to three numbers, and a missing class is zero. */
  private value(genotype: number): number {
    const c: any = this.counts;
    if (!c) {
      return 0;
    }
    if (Array.isArray(c)) {
      return c.find(x => x.genotype === genotype)?.n ?? 0;
    }
    return c[genotype] ?? c[String(genotype)] ?? 0;
  }

  get total(): number {
    return [0, 1, 2].reduce((sum, g) => sum + this.value(g), 0);
  }

  ngOnChanges(): void {
    const values = [0, 1, 2].map(g => this.value(g));
    this.plotData = [{
      type: 'bar',
      x: [0, 1, 2].map(g => GENOTYPE_LABEL[g]),
      y: values,
      text: values.map(v => String(v)),
      textposition: 'outside',
      cliponaxis: false,
      marker: { color: [0, 1, 2].map(g => GENOTYPE_COLOUR[g]) },
      hovertemplate: '%{x}: %{y} subjects<extra></extra>',
    }];
    this.plotLayout = {
      height: this.height,
      margin: { l: 46, r: 10, t: 10, b: 34 },
      showlegend: false,
      // Plotly 3 drops a plain string title silently and draws nothing
      xaxis: { title: { text: 'Genotype' } },
      yaxis: { title: { text: '# subjects' }, rangemode: 'tozero' },
    };
  }
}
