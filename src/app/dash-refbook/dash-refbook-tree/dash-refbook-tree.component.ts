import { Component, ElementRef, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
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
import { ExportTable } from '../../shared/plot-export/plot-export';
import { exportButtons } from '../../shared/plot-export/plot-export';
import { attachTickTitles } from '../../shared/plotly-tick-titles';

/** Shown as "Group clustering": it groups by sequence similarity and makes. */
interface TreeData {
  labels: string[];
  /** [left, right, height, size]; leaves are 0..n-1, merge k creates node n+k. */
  merges: [number, number, number, number][];
  order: number[];
  informative_columns: number[];
  duplicate_groups: string[][];
  /** IMGT columns when gapped, the longest sequence otherwise. */
  columns: number;
  /** False for D and J, which have no gapped form. */
  gapped: boolean;
}

@Component({
  selector: 'app-dash-refbook-tree',
  templateUrl: './dash-refbook-tree.component.html',
  styles: [`
    .tree-status { margin: 1rem 0; font-size: 0.9rem; color: var(--vdj-muted); }

    .tree-caption { margin: 0.25rem 0 0.5rem; font-size: 0.78rem; color: var(--vdj-muted); }

    .tree-note { font-size: 0.8rem; margin-bottom: 0.25rem; }
    .note-toggle { background: none; border: 0; padding: 0; color: var(--vdj-teal); font-size: 0.8rem; cursor: pointer; }
    .tree-note table { margin-top: 0.3rem; border-collapse: collapse; }
    .tree-note td { padding: 0.12rem 0.75rem 0.12rem 0; vertical-align: top; color: var(--vdj-ink); }
    .tree-note td:last-child { color: var(--vdj-body); word-break: break-all; }
    .tree-note ul { margin: 0.3rem 0 0; padding-left: 1.1rem; color: var(--vdj-body); }
    .tree-note li { word-break: break-all; }

    .legend-short { font-family: 'Roboto Mono', Menlo, Consolas, monospace; white-space: nowrap; }
  `],
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
  private fullByLabel = new Map<string, string>();
  showLegend = false;
  showDuplicates = false;

  plotData: any[] = [];
  plotLayout: any = {};
  plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.selection?.asc}_clustering`,
      title: `${this.selection?.asc} allele group clustering`,
      table: this.exportTable, script: this.exportScript,
    })),
  };

  constructor(private http: HttpClient, private drill: DashDrillService,
              private host: ElementRef<HTMLElement>) {}

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
  /** What was compared, which is not the same question for V as for D and J. */
  get columnsNote(): string {
    if (!this.tree) {
      return '';
    }
    if (!this.tree.gapped) {
      return 'These alleles have no IMGT-gapped form and differ in length, so each pair is '
           + 'aligned end to end; the distance counts inserted and deleted bases as well as '
           + 'substituted ones.';
    }
    const informative = this.tree.informative_columns.length;
    return `${informative} of ${this.tree.columns} IMGT-gapped positions vary between these `
         + 'alleles; the distance counts positions that differ.';
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
          this.error = err?.error?.message ?? err?.message ?? 'Could not load the grouping';
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

  /** A click on a leaf marker opens that allele. */
  onPlotClick(event: { points?: { customdata?: string }[] }): void {
    const name = event?.points?.[0]?.customdata;
    if (name) {
      this.drill.drill('allele', name);
    }
  }

  /** The dendrogram's own numbers, which its traces are not. */
  /** How the distances were measured, for the script's header. */
  private get metricNote(): string {
    const tree = this.tree;
    return tree?.gapped
      ? `Distance is the number of differing positions over ${tree.columns} IMGT-gapped\n`
        + `# columns, ${tree.informative_columns.length} of which vary between these alleles.\n`
        + '# Terminal gaps are treated as unrecorded sequence, not as differences.'
      : 'Distance is a Needleman-Wunsch edit distance: these alleles have no gapped\n'
        + '# form and differ in length, so each pair is aligned end to end and an\n'
        + '# inserted or deleted base counts the same as a substituted one.';
  }

  get exportTable(): ExportTable {
    if (!this.tree?.merges?.length) {
      return { columns: [], rows: [] };
    }
    return {
      columns: ['left', 'right', 'distance_nt', 'size'],
      rows: this.tree.merges.map(m => [m[0], m[1], m[2], m[3]]),
    };
  }

  get exportScript(): string {
    const tree = this.tree;
    if (!tree?.merges?.length) {
      return '';
    }
    const quote = (t: string) => "'" + t.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    const Z = tree.merges.map(m => `    [${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}],`).join('\n');
    const labels = tree.labels.map(quote).join(',\n    ');

    return `# ${this.selection?.asc} - allele group clustering
#
# Generated by VDJbase. Z is scipy's linkage format: leaves are 0..n-1 and row k
# creates cluster n+k.
#
# ${this.metricNote}
#
# Linkage is complete, so a join sits at the distance of the furthest pair.
#
# To pull the data again instead:
#   /api/refbook/asc_tree/${this.selection?.species}/${this.selection?.chain}/${this.selection?.asc}
#
# pip install scipy matplotlib

import matplotlib.pyplot as plt
from scipy.cluster.hierarchy import dendrogram

LABELS = [
    ${labels},
]

Z = [
${Z}
]

fig, ax = plt.subplots(figsize=(8, max(3, 0.22 * len(LABELS))))
dendrogram(Z, labels=LABELS, orientation='right', ax=ax,
           color_threshold=0, above_threshold_color='#188080')
ax.set_xlabel('Distance (nt)')
fig.tight_layout()
fig.savefig('figure.png', dpi=300)
plt.show()
`;
  }

  /** Give each shortened allele tick its full name as a native tooltip. */
  labelTitles(): void {
    attachTickTitles(this.host.nativeElement, this.fullByLabel);
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
    const y = new Array<number>(n + tree.merges.length).fill(0);
    const x = new Array<number>(n + tree.merges.length).fill(0);
    tree.order.forEach((leaf, position) => { y[leaf] = position; });

    // one trace, with a null breaking the line between one merge and the next: a
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
    // what each leaf tick stands for, for the hover
    this.fullByLabel = new Map(tree.labels.map((full, i) => [short[i], full]));

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
        title: { text: 'Distance (nt)' },
        automargin: true,
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
