import { Component, Injectable, Input, OnChanges, SimpleChanges, OnInit, ViewEncapsulation } from '@angular/core';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection } from '../species-gene-selector/species-gene-selector.model';
import { PlotlyModule } from 'angular-plotly.js';
import { UsageData } from './dash-refbook-usage.model';

@Component({
  selector: 'app-dash-refbook-usage',
  templateUrl: './dash-refbook-usage.component.html',
  styleUrls: ['./dash-refbook-usage.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [PlotlyModule],
})

@Injectable({ providedIn: 'root' })

export class DashRefbookUsageComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error = '';
  usageData: UsageData = { alleles: [] };

  
  plotData: any[] = [];
  plotLayout: any = {
    title: { text: 'Allele usage fractions' },
    yaxis: { title: 'Fraction', rangemode: 'tozero', zeroline: true, automargin: true },
    xaxis: { title: 'Allele', tickangle: -45, automargin: true },
    boxmode: 'group',
    width: 1500,
    height: 800,
    showlegend: false,
  };
  plotConfig = { responsive: true };

  constructor(private refbookService: RefbookService) {}

  ngOnInit() {
    this.fetchUsageData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection']) {
      this.fetchUsageData();
    }
  }

  fetchUsageData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) return;

    this.isFetching = true;
    this.error = '';
    this.usageData = { alleles: [] };

    this.refbookService.getAscUsage(this.selection.species, this.selection.chain, this.selection.asc)
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          console.error('getAscUsage ERROR:', err);
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

  private updatePlot() {
    const alleles = this.usageData.alleles ?? [];

    const nonEmpty = alleles.filter(a => Array.isArray(a.usage) && a.usage.length > 0);

    const traces = nonEmpty.map(a => ({
      type: 'box',
      name: a.name,
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

    const n = nonEmpty.length || 1;
    this.plotLayout.width = Math.max(1200, 600+n * 80);
  }
}
