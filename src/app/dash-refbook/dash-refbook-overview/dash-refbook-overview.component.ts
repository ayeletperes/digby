import { Component, Input, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective  } from 'ng2-charts';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection, sourcesParam, allelesParam, projectsParam, samplesParam }
  from '../../shared/models/species-gene-selection.model';
import { shortenAlleleName } from '../../shared/models/gene-naming';
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
    plugins: {
      tooltip: {
        callbacks: {
          // a raw count means little without the cohort it came out of
          label: (item) => {
            const series = item.dataset.label ?? '';
            const n = Number(item.parsed.y ?? 0);
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
    scales: {
      // Not stacked: the two series are counts of the same samples from different
      // databases, so an allele in both would be counted twice by a stacked bar.
      // Side by side, the comparison between databases is the point.
      x: {
        stacked: false,
        title: {
          display: true,
          text: 'Allele',
        },
      },
      y: {
        stacked: false,
        beginAtZero: true,
        title: {
          display: true,
          text: 'Samples carrying the allele',
        }
      }
    }
  };

  public chartType: 'bar' = 'bar';

constructor(private refbookService: RefbookService, private drill: DashDrillService) { }

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

  /** Where those samples come from, opened from the cohort box. */
  showProjects = false;
  projectsLoading = false;
  projectData: ChartData<'bar'> = { labels: [], datasets: [] };
  public projectOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: {
      x: { stacked: false, title: { display: true, text: 'Project' } },
      y: { stacked: false, beginAtZero: true, title: { display: true, text: 'Samples' } },
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
              { label: 'Genomic', data: projects.map(p => p.by_source?.['genomic'] ?? 0),
                backgroundColor: '#a9e1d4', borderColor: '#8DD3C7', borderWidth: 1 },
              { label: 'AIRR-seq', data: projects.map(p => p.by_source?.['airrseq'] ?? 0),
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

      this.alleleByIndex = data.alleles ?? [];
      this.chartData = {
        labels: (data.alleles ?? []).map(name => shortenAlleleName(name)),
        datasets: series.filter(entry => entry.show).map(({ show, ...dataset }) => dataset),
      };
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
