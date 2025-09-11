import { Component, Injectable, Input, OnChanges, SimpleChanges, OnInit, ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BaseChartDirective  } from 'ng2-charts';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection } from '../species-gene-selector/species-gene-selector.model';
import { OverviewData } from './dash-refbook-overview.model';
import { ChartConfiguration, ChartData, ChartOptions, Chart, registerables } from 'chart.js';

Chart.register(...registerables);


@Component({
  selector: 'app-dash-refbook-overview',
  templateUrl: './dash-refbook-overview.component.html',
  styleUrls: ['./dash-refbook-overview.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [FormsModule, BaseChartDirective ]
})

@Injectable({
  providedIn: 'root'
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
      x: {
        stacked: true, // Enable stacking on the X-axis
      },
      y: {
        stacked: true, // Enable stacking on the Y-axis
        beginAtZero: true,
        title: {
          display: true,
          text: 'Sample Count' // Y-axis label
        }
      }
    }
  };

  public chartType: 'bar' = 'bar';

constructor(private refbookService: RefbookService) { }

  ngOnInit() {
    
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && changes['selection'].currentValue) {
        const cs = changes['selection'].currentValue;
        this.selection = changes['selection'].currentValue;
        this.isFetching = true;
        this.refbookService.getAscsOverview(cs.species, cs.chain, cs.asc)
          .pipe(
            retryWithBackoff(),
            catchError(err => {
              this.error = err;
              return EMPTY;
            })
          )
          .subscribe((data: OverviewData) => {
            this.isFetching = false;
            this.overviewData = data;
            
            // Create new chart data object to trigger change detection
            this.chartData = {
              labels: data.alleles,
              datasets: [
                {
                  label: 'Genomic Only',
                  data: data.genomic_only_counts,
                  backgroundColor: '#a9e1d4',
                  borderColor: '#8DD3C7',
                  borderWidth: 1
                },
                {
                  label: 'AIRRseq Only',
                  data: data.vdjbase_only_counts,
                  backgroundColor: '#FFA07A',
                  borderColor: '#fa946b',
                  borderWidth: 1
                },
                {
                  label: 'Both',
                  data: data.both_counts,
                  backgroundColor: '#ce93d8',
                  borderColor: '#ba68c8',
                  borderWidth: 1
                }
              ]
            };
            
          });
    }
  }
}
