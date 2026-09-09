import { Component, ElementRef, Input, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlotlyModule } from 'angular-plotly.js';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection, sourcesParam, allelesParam, projectsParam, samplesParam }
  from '../../shared/models/species-gene-selection.model';
import { shortenAlleleNames } from '../../shared/models/gene-naming';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { exportButtons } from '../../shared/plot-export/plot-export';
import { attachTickTitles } from '../../shared/plotly-tick-titles';


export class OverviewData {
  total: number;
  novel: number;
  baseline: number;
  alleles: string[];
  genomic_only_counts: number[];
  vdjbase_only_counts: number[];
  both_counts: number[];
  genomic_counts?: number[];
  vdjbase_counts?: number[];
  /** How many samples the figures are drawn from, and how many are the same sample in both databases. */
  cohort?: { genomic: number; airrseq: number; shared: number };
}

@Component({
  selector: 'app-dash-refbook-overview',
  templateUrl: './dash-refbook-overview.component.html',
  styleUrls: ['./dash-refbook-overview.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, PlotlyModule, ScopeNoteComponent]
})

export class DashRefbookOverviewComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;
  isFetching: boolean;
  error: string;

  overviewData: OverviewData = {
    total: 0,
    novel: 0,
    baseline: 0,
    alleles: [],
    genomic_only_counts: [],
    vdjbase_only_counts: [],
    both_counts: []
  };

  // Create the chart data
  /** Plotly traces and layout. One trace per database. */
  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};
  readonly plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.selection?.asc}_alleles`,
      title: `Alleles of ${this.selection?.asc}, by samples carrying them`,
      source: `/api/refbook/ascs_overview/${this.selection?.species}/${this.selection?.chain}`
              + `/${this.selection?.asc}`,
      data: this.plotData, layout: this.plotLayout,
    })),
  };

  /** The project breakdown is a second figure and exports itself. */
  readonly projectConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.selection?.asc}_by_project`,
      title: `${this.selection?.asc} samples by project`,
      source: `/api/refbook/projects/${this.selection?.species}/${this.selection?.chain}`,
      data: this.projectData, layout: this.projectLayout,
    })),
  };

  /** Full allele names by row, since the tick text is the shortened label. */
  private alleleByIndex: string[] = [];

  /** Samples available per series, so a bar can be read as a share. */
  private denominators: Record<string, number> = {};

constructor(private refbookService: RefbookService, private drill: DashDrillService,
              private host: ElementRef<HTMLElement>) { }

  /** The canvas keeps whatever height it was given on first paint, so a chart built before the alleles arrived stays at the 320px floor while its. */
  ngOnInit() {
    this.fetchData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetchData();
    }
  }

  private fetchData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) {
      this.isFetching = false;
      this.error = null;
      this.overviewData = {
        total: 0, novel: 0, baseline: 0, alleles: [],
        genomic_only_counts: [], vdjbase_only_counts: [], both_counts: [],
      };
      this.plotData = [];
      this.plotLayout = {};
      return;
    }

    this.isFetching = true;
    this.error = null;

    this.refbookService.getAscsOverview(this.selection.species, this.selection.chain, this.selection.asc,
                                        sourcesParam(this.selection), allelesParam(this.selection),
                                        projectsParam(this.selection), samplesParam(this.selection))
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = err.message || err;
          this.isFetching = false;
          return EMPTY;
        })
      )
      .subscribe((data: OverviewData) => {
        this.isFetching = false;
        this.overviewData = data;
        setTimeout(() => this.updateChartData(data), 0);
      });
  }

  /** Samples behind the figures, and how many are the same sample in both. */
  cohort: { genomic: number; airrseq: number; shared: number } | null = null;

  /** Hide alleles no sample carries. */
  unobserved = 0;
  private fullByLabel = new Map<string, string>();
  private lastOverview: (OverviewData & { genomic_counts?: number[]; vdjbase_counts?: number[] }) | null = null;

  /** Row order. */
  sortBy: 'count' | 'name' = 'count';

  setSort(order: 'count' | 'name'): void {
    this.sortBy = order;
    if (this.lastOverview) { this.updateChartData(this.lastOverview); }
  }

  /** Beyond this the chart is taller than its box, so the bottom axis scrolls away. */
  private static readonly SCROLLS_ABOVE = 22;

  /** The wrapper follows the plot, which sizes itself from the allele count. */
  get chartHeight(): number {
    return (this.plotLayout['height'] as number) ?? 320;
  }

  /** Where those samples come from, opened from the cohort box. */
  showProjects = false;
  projectsLoading = false;
  projectData: unknown[] = [];
  projectLayout: Record<string, unknown> = {
    barmode: 'group', height: 260,
    margin: { l: 60, r: 20, t: 10, b: 60 },
    xaxis: { title: { text: 'Project' }, type: 'category', automargin: true, ticks: 'outside' },
    yaxis: { title: { text: 'Samples carrying the allele' }, rangemode: 'tozero', automargin: true, ticks: 'outside',
             gridcolor: 'rgba(0,0,0,0.06)' },
    legend: { orientation: 'h', y: -0.25, x: 0.5, xanchor: 'center' },
  };

  toggleProjects(): void {
    this.showProjects = !this.showProjects;
    if (this.showProjects && !this.projectData.length) {
      this.loadProjects();
    }
  }

  private loadProjects(): void {
    const { species, chain } = this.selection ?? {};
    if (!species || !chain) { return; }

    this.projectsLoading = true;
    this.refbookService.getProjects(species, chain, sourcesParam(this.selection))
      .subscribe({
        next: (rec: { projects?: { name: string; by_source?: Record<string, number> }[] }) => {
          const projects = rec?.projects ?? [];
          // one bar per database, matching the colours the panel above uses
          this.projectData = [
            // null rather than 0, as above: a project the database does not
            { type: 'bar', name: 'Genomic', x: projects.map(p => p.name),
              y: projects.map(p => p.by_source?.['genomic'] || null),
              marker: { color: '#a9e1d4', line: { color: '#8DD3C7', width: 1 } },
              hovertemplate: '%{x}<br>Genomic: %{y} samples<extra></extra>' },
            { type: 'bar', name: 'AIRR-seq', x: projects.map(p => p.name),
              y: projects.map(p => p.by_source?.['airrseq'] || null),
              marker: { color: '#FFA07A', line: { color: '#fa946b', width: 1 } },
              hovertemplate: '%{x}<br>AIRR-seq: %{y} samples<extra></extra>' },
          ].filter(t => (t.y as (number | null)[]).some(v => v));
          this.projectsLoading = false;
        },
        error: () => { this.projectData = []; this.projectsLoading = false; },
      });
  }

  private updateChartData(data: OverviewData & { genomic_counts?: number[]; vdjbase_counts?: number[] }): void {
    try {
      const sources = this.selection?.sources ?? [];
      const hasGenomic = !sources.length || sources.includes('genomic');
      const hasAirrseq = !sources.length || sources.includes('airrseq');

      this.cohort = data.cohort ?? null;
      // the source toggle changes which projects exist, so drop the cache
      this.projectData = [];
      if (this.showProjects) { this.loadProjects(); }
        // Three exclusive buckets: seen in the repertoire and not the genome, in
        // the genome and not the repertoire, and in both. Each is out of the
        // cohort it can be drawn from.
        const bothPossible = hasGenomic && hasAirrseq && (data.cohort?.shared ?? 0) > 0;

        this.denominators = bothPossible
          ? { 'Genomic only': data.cohort?.genomic ?? 0,
              'AIRR-seq only': data.cohort?.airrseq ?? 0,
              Both: data.cohort?.shared ?? 0 }
          : { Genomic: data.cohort?.genomic ?? 0, 'AIRR-seq': data.cohort?.airrseq ?? 0 };

        const series = [
          {
            label: bothPossible ? 'Genomic only' : 'Genomic', show: hasGenomic,
            data: bothPossible ? data.genomic_only_counts : data.genomic_counts,
            backgroundColor: '#a9e1d4', borderColor: '#8DD3C7', borderWidth: 1,
          },
          {
            label: bothPossible ? 'AIRR-seq only' : 'AIRR-seq', show: hasAirrseq,
            data: bothPossible ? data.vdjbase_only_counts : data.vdjbase_counts,
            backgroundColor: '#FFA07A', borderColor: '#fa946b', borderWidth: 1,
          },
          {
            label: 'Both', show: bothPossible,
            data: data.both_counts,
            backgroundColor: '#ce93d8', borderColor: '#ba68c8', borderWidth: 1,
          },
        ];

      this.lastOverview = data;
      const names = data.alleles ?? [];
      const seen = (i: number) =>
        (data.genomic_counts?.[i] ?? 0) + (data.vdjbase_counts?.[i] ?? 0) > 0;
      const total = (i: number) =>
        (data.genomic_counts?.[i] ?? 0) + (data.vdjbase_counts?.[i] ?? 0);
      // Nothing is dropped here. The rail's "seen in" thresholds are the one
      const keep = names.map((_, i) => i)
        .sort((a, b) => this.sortBy === 'name'
          ? names[a].localeCompare(names[b])
          // most-carried at the top: Chart.js draws the first category at the
          : total(b) - total(a) || names[a].localeCompare(names[b]));
      this.unobserved = names.length - names.filter((_, i) => seen(i)).length;

      this.alleleByIndex = keep.map(i => names[i]);
      const display = shortenAlleleNames(keep.map(i => names[i]));
      // what each tick stands for, for the hover
      this.fullByLabel = new Map(keep.map(i =>
        [display.get(names[i]) ?? names[i], names[i]]));
      const ticks = keep.map(i => display.get(names[i]) ?? names[i]);
      const rows = ticks.length;
      const mirrored = rows > DashRefbookOverviewComponent.SCROLLS_ABOVE;

      // Plotly draws categories bottom-up, so reverse to put the most-carried
      const order = [...keep].reverse();
      const tickText = [...ticks].reverse();

      this.plotData = [
        ...series.filter(entry => entry.show).map(entry => ({
          type: 'bar', orientation: 'h',
          name: entry.label,
          y: tickText,
          // null, not 0: a genuine zero must draw nothing, or an allele absent
          x: order.map(i => (entry.data?.[i] ?? 0) || null),
          customdata: order.map(i => names[i]),
          marker: { color: entry.backgroundColor,
                    line: { color: entry.borderColor, width: 1 } },
          hovertemplate: '%{customdata}<br>' + entry.label +
                         ': %{x} of ' + (this.denominators[entry.label] || 0) +
                         ' samples<extra></extra>',
        })),
        // Plotly will not draw an overlaying axis that no trace is assigned to,
        ...(mirrored ? [{ type: 'scatter', mode: 'markers', xaxis: 'x2',
                          x: [null], y: [null], marker: { opacity: 0 },
                          showlegend: false, hoverinfo: 'skip' }] : []),
      ];

      this.plotLayout = {
        barmode: 'group',
        height: Math.max(320, 26 * rows + (mirrored ? 155 : 100)),
        // the top band holds the legend, then the mirrored axis title, then its
        margin: { l: 200, r: 20, t: mirrored ? 95 : 40, b: 50 },
        xaxis: {
          title: { text: 'Samples carrying the allele' }, rangemode: 'tozero',
          // vertical rules run across horizontal bars, not along them, and are
          showgrid: true, gridcolor: 'rgba(0,0,0,0.06)', zeroline: false,
          ticks: 'outside', automargin: true,
        },
        xaxis2: {
          matches: 'x', overlaying: 'x', side: 'top', visible: mirrored,
          title: { text: 'Samples carrying the allele' }, showgrid: false, ticks: 'outside',
        },
        yaxis: { title: { text: 'Allele' }, type: 'category', automargin: true,
                 ticks: 'outside', showgrid: false },
        // anchored to the figure rather than the plotting area: a legend placed
        legend: { orientation: 'h', x: 0.5, xanchor: 'center',
                  yref: 'container', y: 1, yanchor: 'top' },
        hovermode: 'closest',
      };
    } catch (error) {
      // Silently handle any chart update errors
      this.error = 'Error updating chart';
    }
  }

  /** Give each shortened allele tick its full name as a native tooltip. */
  labelTitles(): void {
    attachTickTitles(this.host.nativeElement, this.fullByLabel);
  }

  onPlotClick(event: { points?: { customdata?: unknown }[] }): void {
    // customdata carries the full name, since the tick text is the shortened one
    const allele = event?.points?.[0]?.customdata as string | undefined;
    if (allele) {
      this.drill.drill('allele', allele);
    }
  }

  /** Reads back what the figures cover, so the numbers are not context-free. */
  get scopeDescription(): string {
    const parts: string[] = [];
    const gene = this.selection?.asc;
    const species = this.selection?.species;

    parts.push(gene ? `alleles of ${gene}` : 'alleles');
    if (species) {
      parts.push(`in ${species}`);
    }

    const sources = this.selection?.sources ?? [];
    if (sources.length === 1) {
      parts.push(`from ${sources[0] === 'genomic' ? 'genomic' : 'AIRR-seq'} data`);
    } else {
      parts.push('from genomic and AIRR-seq data');
    }

    // which projects each database is narrowed to is stated by the scope note,
    return parts.join(' ') + '.';
  }
}
