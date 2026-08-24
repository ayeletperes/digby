import { Component, Input, OnChanges, SimpleChanges, OnInit } from '@angular/core';
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
  imports: [FormsModule, BaseChartDirective, ScopeNoteComponent]
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
  public chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      // Not stacked: the two series are counts of the same samples from different
      // databases, so an allele in both would be counted twice by a stacked bar.
      // Side by side, the comparison between databases is the point.
      x: {
        stacked: false,
      },
      y: {
        stacked: false,
        beginAtZero: true,
        title: {
          display: true,
          text: 'Sample Count' // Y-axis label
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

  private updateChartData(data: OverviewData & { genomic_counts?: number[]; vdjbase_counts?: number[] }): void {
    try {
      const sources = this.selection?.sources ?? [];
      const hasGenomic = !sources.length || sources.includes('genomic');
      const hasAirrseq = !sources.length || sources.includes('airrseq');

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
