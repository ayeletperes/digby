import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlotlyModule } from 'angular-plotly.js';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { QtlService } from '../qtl.service';
import {
  QtlLead, QtlPoint, QtlSelection, QtlThreshold, usageThreshold,
} from '../../shared/models/qtl-selection.model';

/**
 * Association strength along the locus.
 *
 * Two different plots, and the difference matters. With an ASC chosen this is a
 * Manhattan in the ordinary sense: one scan, one test per point. With no ASC it
 * is *not* - each point is that variant's strongest result across every ASC
 * scanned, so neighbouring points routinely come from different tests and the
 * height of a point is a maximum over ~30 of them. In IGL all 35 ASCs win at
 * least one point and the busiest wins only 573 of 4,581, so the skyline is a
 * patchwork rather than one scan's null. It is labelled accordingly rather than
 * being called a Manhattan.
 *
 * The threshold line survives both: the run computes one usage threshold per
 * locus and applies it to every ASC's scan, so a point above the line did clear
 * it in whichever scan produced it.
 *
 * Positions are locus-relative - IGH sits on a contig named `igh` while the
 * light chains use chr2 and chr22 - so the axis is only meaningful within the
 * locus being shown, and never compared across them.
 */
@Component({
  selector: 'app-qtl-manhattan',
  templateUrl: './qtl-manhattan.component.html',
  styleUrls: ['./qtl-manhattan.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule],
})
export class QtlManhattanComponent implements OnChanges {
  @Input() selection: QtlSelection;

  /**
   * A variant the user clicked, with the ASC whose scan produced that point.
   *
   * The ASC matters: in the whole-locus view each point is the strongest of
   * several tests, so without it the shell would not know whose usage to plot.
   */
  @Output() variantPicked = new EventEmitter<{ variant: string; asc?: string }>();

  isFetching = false;
  error: string | null = null;

  points: QtlPoint[] = [];
  leads: QtlLead[] = [];
  thresholds: QtlThreshold[] = [];
  /** The contig the positions are on, which is the frame the axis is drawn in. */
  contig: string | null = null;

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};
  readonly plotConfig = { responsive: true, displaylogo: false };

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selection']) {
      this.fetch();
    }
  }

  get threshold(): QtlThreshold | undefined {
    return usageThreshold(this.thresholds);
  }

  /** How many separate scans the overview is taking a maximum over. */
  get ascCount(): number | null {
    return this.threshold?.n_asc ?? null;
  }

  get significantCount(): number {
    return this.points.filter(p => p.significant).length;
  }

  onPlotClick(event: { points?: { customdata?: string[] }[] }): void {
    const custom = event?.points?.[0]?.customdata;
    if (Array.isArray(custom) && custom[0]) {
      this.variantPicked.emit({ variant: custom[0], asc: custom[1] });
    }
  }

  private fetch(): void {
    const { species, locus, asc } = this.selection ?? {};
    if (!species || !locus) {
      this.points = [];
      return;
    }

    this.isFetching = true;
    this.error = null;

    this.qtl.manhattan(species, locus, asc)
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? err?.message ?? 'Could not load the scan';
        this.isFetching = false;
        return EMPTY;
      }))
      .subscribe(result => {
        this.isFetching = false;
        this.points = result.points ?? [];
        this.leads = result.leads ?? [];
        this.thresholds = result.thresholds ?? [];
        this.contig = result.contig ?? null;
        this.build();
      });
  }

  private build(): void {
    const line = this.threshold?.neglog10_threshold ?? null;

    // split rather than colour by value: significance is a decision made against
    // the threshold, not a gradient, and the legend should say so
    const below = this.points.filter(p => !p.significant);
    const above = this.points.filter(p => p.significant);

    const trace = (rows: QtlPoint[], name: string, colour: string, size: number) => ({
      type: 'scattergl',
      mode: 'markers',
      name,
      x: rows.map(p => (p.pos ?? 0) / 1e6),
      y: rows.map(p => p.neglog10_p),
      // both travel with the point: the variant clicked, and the scan it came from
      customdata: rows.map(p => [p.variant, p.asc]),
      marker: { size, color: colour, opacity: 0.75 },
      hovertemplate:
        '%{customdata[0]}<br>usage of %{customdata[1]}' +
        '<br>position %{x:.3f} Mb<br>-log10 p = %{y:.2f}<extra></extra>',
    });

    this.plotData = [
      trace(below, 'not significant', '#9aa0a6', 5),
      trace(above, 'significant', '#d62839', 6),
    ];

    this.plotLayout = {
      autosize: true,
      height: 420,
      margin: { l: 60, r: 20, t: 16, b: 50 },
      xaxis: {
        // name the contig, not the locus: these are that contig's coordinates,
        // and IGH's `igh` is locus-relative while the light chains are on chr2 /
        // chr22, so the two are not the same statement
        title: `${this.contig ?? this.selection?.locus} position (Mb)`,
        zeroline: false, automargin: true, tickformat: '.2f',
      },
      yaxis: { title: this.selection?.asc ? '-log10 p' : `-log10 p (best of ${this.ascCount ?? 'all'} scans)`,
               rangemode: 'tozero' },
      hovermode: 'closest',
      legend: { orientation: 'h', y: 1.12, x: 0 },
      shapes: line === null ? [] : [{
        type: 'line', xref: 'paper', x0: 0, x1: 1, y0: line, y1: line,
        line: { color: '#f9ab00', width: 1, dash: 'dash' },
      }],
      annotations: line === null ? [] : [{
        xref: 'paper', x: 1, y: line, xanchor: 'right', yanchor: 'bottom',
        text: `significance threshold`, showarrow: false,
        font: { size: 10, color: '#b06000' },
      }],
    };
  }
}
