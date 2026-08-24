import { Component, Input, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection, projectsParam, samplesParam, allelesParam }
  from '../../shared/models/species-gene-selection.model';
import { shortenAlleleName } from '../../shared/models/gene-naming';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { PlotlyModule } from 'angular-plotly.js';
import { UsageData } from './dash-refbook-usage.model';

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
  showLegend = false;


  plotData: any[] = [];
  plotLayout: any = {
    title: { text: 'Allele usage fractions' },
    yaxis: { title: 'Fraction', rangemode: 'tozero', zeroline: true, automargin: true },
    xaxis: { title: 'Allele', tickangle: -45, automargin: true },
    boxmode: 'group',
    // no fixed width: the plot fills its column, and several of these are stacked
    autosize: true,
    height: 420,
    margin: { l: 60, r: 20, t: 40, b: 80 },
    showlegend: false,
  };
  plotConfig = { responsive: true, displaylogo: false };

  constructor(private refbookService: RefbookService, private drill: DashDrillService) {}

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

  /**
   * A click on a jittered point identifies one sample; a click on the box itself
   * identifies the allele. Plotly reports both through the same event, so the
   * point's customdata is what tells them apart.
   */
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
    // tick is shortened and the full name is kept for the hover box.
    const traces = nonEmpty.map(a => ({
      type: 'box',
      name: shortenAlleleName(a.name),
      y: a.usage,                 // array of fractions for this allele across samples
      customdata: a.samples,      // array of sample names corresponding to each fraction
      boxpoints: 'all',           // show points
      jitter: 0.35,               // spread points horizontally
      pointpos: -1.5,             // center points on the box
      marker: { size: 6, opacity: 0.6 },
      line: { width: 1 },
      hovertemplate: 'Sample: %{customdata}<br>Fraction: %{y:.3f}<extra>' + a.name + '</extra>'
    }));

    this.plotData = traces;
    this.alleleByCurve = nonEmpty.map(a => a.name);
    this.legend = nonEmpty
      .map(a => ({ short: shortenAlleleName(a.name), full: a.name }))
      .filter(entry => entry.short !== entry.full);

    // the bottom margin has to hold the rotated tick labels, so it follows the
    // longest one rather than being fixed
    const n = nonEmpty.length || 1;
    const longest = traces.reduce((m, t) => Math.max(m, t.name.length), 0);
    this.plotLayout = {
      ...this.plotLayout,
      height: Math.min(700, Math.max(320, 260 + n * 14)),
      margin: { ...this.plotLayout.margin, b: Math.min(200, Math.max(80, longest * 7)) },
    };
  }
}
