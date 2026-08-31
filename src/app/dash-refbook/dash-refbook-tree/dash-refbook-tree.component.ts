import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { PlotlyModule } from 'angular-plotly.js';

import { environment } from '../../../environments/environment';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { SpeciesGeneSelection, sourcesParam, allelesParam }
  from '../../shared/models/species-gene-selection.model';
import { shortenAlleleName } from '../../shared/models/gene-naming';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';

/** /refbook/asc_tree: scipy-style linkage over the alleles of one gene. */
interface TreeData {
  labels: string[];
  /** [left, right, height, size]; leaves are 0..n-1, merge k creates node n+k. */
  merges: [number, number, number, number][];
  order: number[];
  informative_columns: number[];
  duplicate_groups: string[][];
  columns: number;
  metric: string;
}

@Component({
  selector: 'app-dash-refbook-tree',
  templateUrl: './dash-refbook-tree.component.html',
  styleUrls: ['./dash-refbook-tree.component.css'],
  standalone: true,
  imports: [PlotlyModule, ScopeNoteComponent],
})
export class DashRefbookTreeComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error = '';
  tree: TreeData | null = null;

  /** Allele names shortened for the axis, with the original beside them. */
  legend: { short: string; full: string }[] = [];
  showLegend = false;
  showDuplicates = false;

  plotData: any[] = [];
  plotLayout: any = {};
  plotConfig = { responsive: true, displaylogo: false };

  constructor(private http: HttpClient, private drill: DashDrillService) {}

  ngOnInit() {
    this.fetchTree();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetchTree();
    }
  }

  get duplicateGroups(): string[][] {
    return this.tree?.duplicate_groups ?? [];
  }

  /** One line of context under the plot: what the distances were measured over. */
  get columnsNote(): string {
    if (!this.tree) {
      return '';
    }
    const informative = this.tree.informative_columns.length;
    return `${informative} of ${this.tree.columns} aligned positions vary between these alleles.`;
  }

  private fetchTree() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) {
      this.isFetching = false;
      this.error = '';
      this.tree = null;
      this.plotData = [];
      return;
    }

    this.isFetching = true;
    this.error = '';

    let params = new HttpParams();
    const sources = sourcesParam(this.selection);
    const alleles = allelesParam(this.selection);
    if (sources) {
      params = params.set('sources', sources);
    }
    if (alleles) {
      params = params.set('alleles', alleles);
    }

    const url = `${environment.apiBasePath}/refbook/asc_tree/`
      + [this.selection.species, this.selection.chain, this.selection.asc]
        .map(encodeURIComponent).join('/');

    this.http.get<TreeData>(url, { params })
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = err?.error?.message ?? err?.message ?? 'Could not load the tree';
          this.isFetching = false;
          this.tree = null;
          this.plotData = [];
          return EMPTY;
        })
      )
      .subscribe(data => {
        this.tree = data;
        this.isFetching = false;
        this.updatePlot();
      });
  }

  /**
   * A click on a leaf marker opens that allele. The merge trace carries no
   * customdata, so clicking a branch does nothing.
   */
  onPlotClick(event: { points?: { customdata?: string }[] }): void {
    const name = event?.points?.[0]?.customdata;
    if (name) {
      this.drill.drill('allele', name);
    }
  }

  private token(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  private updatePlot() {
    const tree = this.tree;
    if (!tree || tree.labels.length < 2) {
      this.plotData = [];
      this.legend = [];
      return;
    }

    const n = tree.labels.length;

    // A node's y is its position in the leaf order, or the midpoint of its children;
    // its x is the height it was created at, and 0 for a leaf.
    const y = new Array<number>(n + tree.merges.length).fill(0);
    const x = new Array<number>(n + tree.merges.length).fill(0);
    tree.order.forEach((leaf, position) => { y[leaf] = position; });

    // one trace, with a null breaking the line between one merge and the next: a
    // trace per branch would be 2n-1 traces for what is a single drawing
    const branchX: (number | null)[] = [];
    const branchY: (number | null)[] = [];

    tree.merges.forEach(([left, right, height], k) => {
      const node = n + k;
      x[node] = height;
      y[node] = (y[left] + y[right]) / 2;

      branchX.push(x[left], height, height, x[right], null);
      branchY.push(y[left], y[left], y[right], y[right], null);
    });

    const teal = this.token('--vdj-teal', '#188080');
    const short = tree.labels.map(name => shortenAlleleName(name));

    this.plotData = [
      {
        type: 'scatter', mode: 'lines',
        x: branchX, y: branchY,
        line: { color: teal, width: 1.2 },
        hoverinfo: 'skip',
        showlegend: false,
      },
      {
        type: 'scatter', mode: 'markers',
        x: new Array(n).fill(0),
        y: y.slice(0, n),
        customdata: tree.labels,
        marker: { size: 6, color: teal },
        hovertemplate: '%{customdata}<extra></extra>',
        showlegend: false,
      },
    ];

    this.legend = tree.labels
      .map((full, i) => ({ short: short[i], full }))
      .filter(entry => entry.short !== entry.full);

    const longest = short.reduce((m, s) => Math.max(m, s.length), 0);
    const maxHeight = Math.max(...tree.merges.map(m => m[2]), 1);

    this.plotLayout = {
      // the plot has to grow with the gene: 133 alleles do not fit in 420px
      height: Math.min(2000, Math.max(280, 90 + n * 18)),
      autosize: true,
      margin: { l: Math.min(240, Math.max(80, longest * 7 + 20)), r: 20, t: 20, b: 50 },
      xaxis: {
        title: `Differences (${tree.metric})`,
        range: [-maxHeight * 0.02, maxHeight * 1.05],
        zeroline: false,
        gridcolor: this.token('--vdj-rule', '#e7eeed'),
      },
      yaxis: {
        tickmode: 'array',
        tickvals: y.slice(0, n),
        ticktext: short,
        range: [-1, n],
        showgrid: false,
        zeroline: false,
        tickfont: { size: 10 },
      },
      font: { color: this.token('--vdj-body', '#455857') },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      hovermode: 'closest',
      showlegend: false,
    };
  }
}
