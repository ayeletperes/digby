import { Component, ElementRef, Input, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective  } from 'ng2-charts';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection, sourcesParam, allelesParam, projectsParam, samplesParam }
  from '../../shared/models/species-gene-selection.model';
import { shortenAlleleNames } from '../../shared/models/gene-naming';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { OverviewData } from './dash-refbook-overview.model';
import { ChartConfiguration, ChartData, ChartOptions, Chart, registerables } from 'chart.js';

Chart.register(...registerables);


@Component({
  selector: 'app-dash-refbook-overview',
  templateUrl: './dash-refbook-overview.component.html',
  styleUrls: ['./dash-refbook-overview.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective, ScopeNoteComponent]
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
  public chartData: ChartData<'bar'> = {
    labels: [], // Alleles as labels on the X-axis
    datasets: [
      {
        label: 'Genomic Only',
        data: [],
        backgroundColor: '#a9e1d4', // Color for Genomic Only
        borderColor: '#8DD3C7',
        borderWidth: 1
      },
      {
        label: 'AIRRseq Only',
        data: [],
        backgroundColor: '#FFA07A', // Color for AIRRseq Only
        borderColor: '#fa946b',
        borderWidth: 1
      },
      {
        label: 'Both',
        data: [],
        backgroundColor: '#ce93d8', // Color for Genomic + AIRRseq
        borderColor: '#ba68c8',
        borderWidth: 1
      }
    ]
  };

  // Chart configuration
  /** Samples available per series, so a bar can be read as a share. */
  private denominators: Record<string, number> = {};

  public chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    // Hover the column, not the bar. Most alleles here are carried by one or two
    // samples, so their bars are a pixel high against an axis that runs to 350 -
    // `intersect: true` made them effectively unhoverable.
    // Horizontal: allele names are long, and on a category y-axis they read
    // left to right without rotation or truncation. A vertical chart cannot
    // show 384 of them at any width.
    indexAxis: 'y',
    // axis: 'y' matters. The categories run down y now, but Chart.js resolves
    // interactions along x by default, so it was picking the nearest row by
    // bar length rather than by pointer height.
    interaction: { mode: 'index', intersect: false, axis: 'y' },
    plugins: {
      tooltip: {
        callbacks: {
          // a raw count means little without the cohort it came out of
          label: (item) => {
            const series = item.dataset.label ?? '';
            // `raw`, not parsed.y: these are horizontal bars, so the value sits
            // on x and parsed.y is the category index - the tooltip was
            // reporting the allele's position in the list as its sample count
            const raw = item.raw as number | null;
            if (raw === null || raw === undefined) { return `${series}: not present`; }
            const n = Number(raw);
            const total = this.denominators[series] ?? 0;
            if (!total) {
              return `${series}: ${n} samples`;
            }
            const pct = (100 * n / total).toFixed(1);
            return `${series}: ${n} of ${total} samples (${pct}%)`;
          },
        },
      },
    },
    datasets: {
      // a count of 1 has to be visible; without this it rounds away to nothing
      bar: { minBarLength: 3 },
    },
    scales: {
      // Not stacked: the two series are counts of the same samples from different
      // databases, so an allele in both would be counted twice by a stacked bar.
      // Side by side, the comparison between databases is the point.
      x: {
        stacked: false,
        beginAtZero: true,
        title: { display: true, text: 'Samples carrying the allele' },
        // vertical rules are wanted now the bars are horizontal: they run across
        // the bars rather than along them, and they are what lets a value be read
        // in the middle of a long scroll, where neither axis is on screen
        grid: { display: true, drawOnChartArea: true, drawTicks: true, tickLength: 6,
                color: 'rgba(0,0,0,0.06)' },
      },
      // A copy of the value axis along the top, so it is in view when the list is
      // scrolled to the start. Only added when the chart is tall enough to
      // scroll at all - on a short gene it is just clutter.
      x2: {
        display: false,
        position: 'top',
        beginAtZero: true,
        grid: { drawOnChartArea: false, drawTicks: true, tickLength: 6 },
        title: { display: true, text: 'Samples carrying the allele' },
      },
      y: {
        stacked: false,
        title: { display: true, text: 'Allele' },
        // ticks instead of gridlines running through the bars
        grid: { display: true, drawOnChartArea: false, drawTicks: true, tickLength: 6,
                offset: true },
        ticks: { autoSkip: false },
      },
    },
  };

  public chartType: 'bar' = 'bar';

constructor(private refbookService: RefbookService, private drill: DashDrillService,
              private host: ElementRef<HTMLElement>) { }

  /**
   * The canvas keeps whatever height it was given on first paint, so a chart
   * built before the alleles arrived stays at the 320px floor while its
   * container grows to 1,338. `@ViewChild` does not resolve here - the panel is
   * instantiated through NgComponentOutlet - so the canvas is found on the host.
   */
  private resizeChart(): void {
    setTimeout(() => {
      const canvas = this.host.nativeElement.querySelector('canvas');
      if (!canvas) { return; }
      const chart = Chart.getChart(canvas);
      if (!chart) { return; }
      chart.resize();

      // No dataset is attached to the mirrored axis, so Chart.js would scale it
      // 0..1. Copy the real axis's bounds once they have been computed.
      const x = chart.scales['x'], x2 = chart.scales['x2'];
      if (x && x2 && (x2.max !== x.max || x2.min !== x.min)) {
        const opts = chart.options.scales?.['x2'] as { min?: number; max?: number } | undefined;
        if (opts) {
          opts.min = x.min;
          opts.max = x.max;
          chart.update('none');
        }
      }
    });
  }

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
      // Clear existing data when selection is incomplete
      this.overviewData = {
        total: 0,
        novel: 0,
        baseline: 0,
        alleles: [],
        genomic_only_counts: [],
        vdjbase_only_counts: [],
        both_counts: []
      };
      // Clear chart data
      this.chartData = {
        labels: [],
        datasets: [
          {
            label: 'Genomic Only',
            data: [],
            backgroundColor: '#a9e1d4',
            borderColor: '#8DD3C7',
            borderWidth: 1
          },
          {
            label: 'AIRRseq Only',
            data: [],
            backgroundColor: '#FFA07A',
            borderColor: '#fa946b',
            borderWidth: 1
          },
          {
            label: 'Both',
            data: [],
            backgroundColor: '#ce93d8',
            borderColor: '#ba68c8',
            borderWidth: 1
          }
        ]
      };
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

        // Use setTimeout to avoid potential debugger issues
        setTimeout(() => {
          this.updateChartData(data);
        }, 0);
    });
  }

  /** Samples behind the figures, and how many are the same sample in both. */
  cohort: { genomic: number; airrseq: number; shared: number } | null = null;

  /**
   * Hide alleles no sample carries.
   *
   * On by default: the unobserved rows are dominated by `*Del` deletion markers
   * (96 of Human IGH's 106, 524 of rhesus IGH's 1,893), which are genotype
   * states rather than alleles, and they draw as empty bars.
   */
  observedOnly = true;
  hiddenUnobserved = 0;

  /**
   * Row order. Count first, because at 384 alleles (IGHV1-69 in the full HUSA
   * set) the handful anyone carries is what you came for; name is for lookup.
   */
  sortBy: 'count' | 'name' = 'count';

  setSort(order: 'count' | 'name'): void {
    this.sortBy = order;
    if (this.lastOverview) { this.updateChartData(this.lastOverview); }
  }

  /** Rows are a fixed height and the panel scrolls; squeezing 384 into a box is unreadable. */
  get chartHeight(): number {
    return Math.max(320, 26 * (this.chartData.labels?.length ?? 0) + 90);
  }

  /** Beyond this the chart is taller than its box, so the bottom axis scrolls away. */
  private static readonly SCROLLS_ABOVE = 22;

  /** Mirror the value axis on top once the list is long enough to scroll. */
  private syncMirrorAxis(): void {
    const rows = this.chartData.labels?.length ?? 0;
    const scales = this.chartOptions.scales as Record<string, { display?: boolean; max?: number }>;
    if (scales?.['x2']) {
      scales['x2'].display = rows > DashRefbookOverviewComponent.SCROLLS_ABOVE;
    }
  }
  private lastOverview: (OverviewData & { genomic_counts?: number[]; vdjbase_counts?: number[] }) | null = null;

  toggleObservedOnly(): void {
    this.observedOnly = !this.observedOnly;
    if (this.lastOverview) { this.updateChartData(this.lastOverview); }
  }

  /** Where those samples come from, opened from the cohort box. */
  showProjects = false;
  projectsLoading = false;
  projectData: ChartData<'bar'> = { labels: [], datasets: [] };
  public projectOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom' } },
    datasets: { bar: { minBarLength: 3 } },
    scales: {
      x: { stacked: false, title: { display: true, text: 'Project' },
           grid: { display: true, drawOnChartArea: false, drawTicks: true, tickLength: 6,
                   offset: true } },
      y: { stacked: false, beginAtZero: true, title: { display: true, text: 'Samples' },
           grid: { drawTicks: true, tickLength: 6 } },
    },
  };

  toggleProjects(): void {
    this.showProjects = !this.showProjects;
    if (this.showProjects && !this.projectData.labels?.length) {
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
          this.projectData = {
            labels: projects.map(p => p.name),
            datasets: [
              // null rather than 0, as above: a project the database does not
              // hold must draw nothing, not a floor-height bar
              { label: 'Genomic', data: projects.map(p => p.by_source?.['genomic'] || null),
                backgroundColor: '#a9e1d4', borderColor: '#8DD3C7', borderWidth: 1 },
              { label: 'AIRR-seq', data: projects.map(p => p.by_source?.['airrseq'] || null),
                backgroundColor: '#FFA07A', borderColor: '#fa946b', borderWidth: 1 },
            ].filter(d => d.data.some(v => v > 0)),
          };
          this.projectsLoading = false;
        },
        error: () => { this.projectData = { labels: [], datasets: [] }; this.projectsLoading = false; },
      });
  }

  private updateChartData(data: OverviewData & { genomic_counts?: number[]; vdjbase_counts?: number[] }): void {
    try {
      const sources = this.selection?.sources ?? [];
      const hasGenomic = !sources.length || sources.includes('genomic');
      const hasAirrseq = !sources.length || sources.includes('airrseq');

      this.cohort = data.cohort ?? null;
      // the source toggle changes which projects exist, so drop the cache
      this.projectData = { labels: [], datasets: [] };
      if (this.showProjects) { this.loadProjects(); }
      // Both is only drawable when a sample can be in both databases at once.
      const bothPossible = hasGenomic && hasAirrseq && (data.cohort?.shared ?? 0) > 0;
      this.denominators = {
        Genomic: data.cohort?.genomic ?? 0,
        'AIRR-seq': data.cohort?.airrseq ?? 0,
        Both: data.cohort?.shared ?? 0,
      };

      // The previous three series were exclusive buckets with `Both` set to
      // min(genomic, airrseq), so they summed to nothing meaningful and an allele
      // present in both databases reported the smaller figure. These are the true
      // per-database counts; an allele in both simply has two bars.
      // A series whose database is not selected is dropped rather than drawn empty.
      const series = [
        {
          label: 'Genomic', show: hasGenomic,
          data: data.genomic_counts,
          backgroundColor: '#a9e1d4', borderColor: '#8DD3C7', borderWidth: 1,
        },
        {
          label: 'AIRR-seq', show: hasAirrseq,
          data: data.vdjbase_counts,
          backgroundColor: '#FFA07A', borderColor: '#fa946b', borderWidth: 1,
        },
        {
          // A true intersection now, not min(genomic, airrseq): these are the
          // samples that carry the allele in both databases, which only exists
          // where the same sample was sequenced both ways.
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
      const keep = names.map((_, i) => i)
        .filter(i => !this.observedOnly || seen(i))
        .sort((a, b) => this.sortBy === 'name'
          ? names[a].localeCompare(names[b])
          // most-carried at the top: Chart.js draws the first category at the
          // top of a horizontal axis
          : total(b) - total(a) || names[a].localeCompare(names[b]));
      this.hiddenUnobserved = names.length - names.filter((_, i) => seen(i)).length;

      this.alleleByIndex = keep.map(i => names[i]);
      this.chartData = {
        // the collision-safe variant, so the axis agrees with the zygosity
        // sets and the names table rather than inventing its own labels
        labels: (() => {
          const display = shortenAlleleNames(keep.map(i => names[i]));
          return keep.map(i => display.get(names[i]) ?? names[i]);
        })(),
        datasets: series.filter(entry => entry.show).map(({ show, data: values, ...rest }) => ({
          // null, not 0. minBarLength gives every bar a floor so a count of one
          // is visible, and it would give a genuine zero the same floor - an
          // allele absent from a database would draw as if a sample carried it.
          ...rest, data: keep.map(i => (values?.[i] ?? 0) || null),
        })),
      };
      this.syncMirrorAxis();
      this.resizeChart();
    } catch (error) {
      // Silently handle any chart update errors
      this.error = 'Error updating chart';
    }
  }

  /** Bar labels are shortened, so the click is resolved against the full names. */
  private alleleByIndex: string[] = [];

  onChartClick(event: { active?: object[] }): void {
    // ng2-charts types the active elements as plain objects; the bar element
    // carries the category index this chart was built from
    const element = event?.active?.[0] as { index?: number } | undefined;
    const allele = element?.index === undefined ? undefined : this.alleleByIndex[element.index];
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
    // because a selection narrows only the database that holds those projects
    return parts.join(' ') + '.';
  }
}
