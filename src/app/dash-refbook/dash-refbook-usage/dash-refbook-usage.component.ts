import { Component, ElementRef, Input, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection, projectsParam, samplesParam, allelesParam }
  from '../../shared/models/species-gene-selection.model';
import { shortenAlleleNames } from '../../shared/models/gene-naming';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { PlotlyModule } from 'angular-plotly.js';
import { exportButtons } from '../../shared/plot-export/plot-export';
import { attachTickTitles } from '../../shared/plotly-tick-titles';

class UsageData {
  alleles: {
    name: string;
    usage: number[];
    samples: string[];
  }[];
}

@Component({
  selector: 'app-dash-refbook-usage',
  templateUrl: './dash-refbook-usage.component.html',
  styleUrls: ['./dash-refbook-usage.component.css'],
  standalone: true,
  imports: [PlotlyModule, ScopeNoteComponent],
})

export class DashRefbookUsageComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error = '';
  usageData: UsageData = { alleles: [] };

  /** Allele names shortened for the axis, with the original for reference. */
  legend: { short: string; full: string }[] = [];
  /** Tick label to the allele it stands for. */
  private fullByLabel = new Map<string, string>();
  showLegend = false;

  /** Points on or off, for reading the boxes alone. */
  showPoints = true;

  togglePoints(): void {
    this.showPoints = !this.showPoints;
    this.updatePlot();
  }


  plotData: any[] = [];
  plotLayout: any = {
    title: { text: '' },
    // horizontal, as the overview is: the allele names sit on the category axis
    xaxis: { title: { text: 'Relative usage (fraction of rearrangements)' }, rangemode: 'tozero',
             zeroline: true, automargin: true },
    yaxis: { title: { text: 'Allele' }, automargin: true },
    // A copy of the value axis along the top, for when the list is long enough
    xaxis2: {
      matches: 'x', overlaying: 'x', side: 'top',
      title: { text: 'Relative usage (fraction of rearrangements)' },
      showgrid: false, automargin: true, visible: false,
    },
    boxmode: 'group',
    height: 420,
    margin: { l: 60, r: 20, t: 40, b: 60 },
    showlegend: false,
  };
  plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.selection?.asc}_usage`,
      title: `Relative usage of the alleles of ${this.selection?.asc}`,
      source: `/api/refbook/asc_usage/${this.selection?.species}/${this.selection?.chain}`
              + `/${this.selection?.asc}`,
      data: this.plotData, layout: this.plotLayout,
    })),
  };

  constructor(private refbookService: RefbookService, private drill: DashDrillService,
              private host: ElementRef<HTMLElement>) {}

  ngOnInit() {
    this.fetchUsageData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetchUsageData();
    }
  }

  fetchUsageData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) {
      this.isFetching = false;
      this.error = '';
      // Clear existing data when selection is incomplete
      this.usageData = { alleles: [] };
      // Clear plot data
      this.plotData = [];
      return;
    }

    this.isFetching = true;
    this.error = '';
    this.usageData = { alleles: [] };

    this.refbookService.getAscUsage(this.selection.species, this.selection.chain, this.selection.asc,
                     projectsParam(this.selection), samplesParam(this.selection),
                     allelesParam(this.selection))
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = 'Failed to load usage data.';
          this.isFetching = false;
          return EMPTY;
        })
      )
      .subscribe((data: UsageData) => {
        this.usageData = data;
        this.isFetching = false;
        this.updatePlot();
      });
  }

  /** A click on a jittered point identifies one sample; a click on the box itself identifies the allele. */
  onPlotClick(event: { points?: { curveNumber: number; customdata?: string }[] }): void {
    const point = event?.points?.[0];
    if (!point) {
      return;
    }

    if (point.customdata) {
      this.drill.drill('sample', point.customdata);
      return;
    }

    const allele = this.alleleByCurve[point.curveNumber];
    if (allele) {
      this.drill.drill('allele', allele);
    }
  }

  /** Full allele names by trace index, since the trace name is the shortened one. */
  private alleleByCurve: string[] = [];

  private updatePlot() {
    const alleles = this.usageData.alleles ?? [];

    const nonEmpty = alleles.filter(a => Array.isArray(a.usage) && a.usage.length > 0);

    // Axis ticks cannot carry a name like IGHV1-2*02_t211c_t213c_g225a, so the
    const mirrored = nonEmpty.length > 12;
    const display = shortenAlleleNames(nonEmpty.map(a => a.name));
    const traces = nonEmpty.map(a => ({
      type: 'box',
      name: display.get(a.name) ?? a.name,
      x: a.usage,                 // horizontal: the value axis is x
      customdata: a.samples,      // sample name behind each point
      orientation: 'h',
      // without this a box is a hairline: plotly sizes it from the category slot,
      width: 0.65,
      boxpoints: this.showPoints ? 'all' : false,
      jitter: 0.35,
      pointpos: 0,
      marker: { size: 6, opacity: 0.6 },
      line: { width: 1 },
      hovertemplate: 'Sample: %{customdata}<br>Fraction: %{x:.3f}<extra>' + a.name + '</extra>'
    }));

    // Plotly does not draw an overlaying axis that no trace is assigned to, so
    this.plotData = mirrored
      ? [...traces, {
          type: 'scatter', mode: 'markers', xaxis: 'x2',
          x: [null], y: [null],
          marker: { opacity: 0 }, showlegend: false, hoverinfo: 'skip',
        }]
      : traces;
    this.alleleByCurve = nonEmpty.map(a => a.name);
    this.legend = nonEmpty
      .map(a => ({ short: display.get(a.name) ?? a.name, full: a.name }))
      .filter(entry => entry.short !== entry.full);

    // one row per allele, so the plot grows with the list instead of squeezing
    this.plotLayout = {
      ...this.plotLayout,
      // enough per row that the box has depth, not just a line
      height: Math.max(320, 48 * nonEmpty.length + 120),
      xaxis2: { ...this.plotLayout.xaxis2, visible: mirrored },
      margin: { ...this.plotLayout.margin, t: mirrored ? 80 : 40 },
    };

    // What each tick stands for, for the hover: the axis can only carry the
    this.fullByLabel = new Map(nonEmpty.map(a => [display.get(a.name) ?? a.name, a.name]));
  }

  /** Give each shortened allele tick its full name as a native tooltip. */
  labelTitles(): void {
    attachTickTitles(this.host.nativeElement, this.fullByLabel);
  }
}
