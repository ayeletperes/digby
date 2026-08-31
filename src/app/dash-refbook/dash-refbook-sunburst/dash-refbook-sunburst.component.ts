import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { PlotlyModule } from 'angular-plotly.js';

import { environment } from '../../../environments/environment';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { SpeciesGeneSelection, sourcesParam } from '../../shared/models/species-gene-selection.model';
import { DashDrillService } from '../dash-drill.service';
import { fills, layout, SunburstLayout, SunburstPayload } from './sunburst-layout';

/**
 * The locus as a sunburst: chain, gene type, subgroup, ASC, allele.
 *
 * One request per species and locus, and nothing after that - drilling recolours
 * arcs that are already drawn.
 *
 * Plotly's sunburst trace draws it. The arcs were hand-rolled at first, to skip
 * the cost of a chart library measuring label text for a few thousand alleles,
 * and that bought a figure with no labels, no hover and no way back to the top.
 * The trace gives all three, and the ring cap below is what keeps it quick.
 */
@Component({
  selector: 'app-dash-refbook-sunburst',
  templateUrl: './dash-refbook-sunburst.component.html',
  styleUrls: ['./dash-refbook-sunburst.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule],
})
export class DashRefbookSunburstComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error: string = null;

  data: SunburstPayload = null;
  private plan: SunburstLayout = null;

  /**
   * Rings drawn at once. All five means a thousand-odd allele arcs a pixel wide,
   * which is where the labels go: Plotly only writes a label that fits its arc.
   * Four stops at the ASC, and drilling in reveals its alleles.
   */
  static readonly RINGS = 4;

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};
  plotConfig = { displaylogo: false, responsive: true,
                 modeBarButtonsToRemove: ['select2d', 'lasso2d'] };

  /** Node the colours are keyed to, or null for the whole locus. */
  drilled: number = null;
  /** Node at the centre, which is Plotly's own zoom and moves with a click. */
  private centre: number = 0;

  private ids: string[] = [];

  constructor(private http: HttpClient, private drill: DashDrillService) {}

  ngOnInit(): void {
    this.fetch();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // the hierarchy depends on species, locus and sources only; refetching when a
    // sibling panel changes the selected allele would throw the drill state away
    // for a payload that is byte for byte the same
    if (changes['selection'] && !changes['selection'].firstChange
        && this.key(changes['selection'].previousValue) !== this.key(this.selection)) {
      this.fetch();
    }
  }

  private key(selection: SpeciesGeneSelection): string {
    return [selection?.species, selection?.chain, sourcesParam(selection ?? {})].join('|');
  }

  private fetch(): void {
    const species = this.selection?.species;
    const locus = this.selection?.chain;

    if (!species || !locus) {
      this.reset();
      return;
    }

    let params = new HttpParams();
    const sources = sourcesParam(this.selection);
    if (sources) {
      params = params.set('sources', sources);
    }

    this.isFetching = true;
    this.error = null;

    const url = `${environment.apiBasePath}/refbook/sunburst/`
      + `${encodeURIComponent(species)}/${encodeURIComponent(locus)}`;

    this.http.get<SunburstPayload>(url, { params })
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = err?.error?.message ?? err?.message ?? 'Could not load the locus map';
          this.isFetching = false;
          this.reset();
          return EMPTY;
        }),
      )
      .subscribe(payload => {
        this.isFetching = false;
        this.load(payload);
      });
  }

  private reset(): void {
    this.data = null;
    this.plan = null;
    this.plotData = [];
    this.ids = [];
    this.drilled = null;
    this.centre = 0;
  }

  private load(payload: SunburstPayload): void {
    this.reset();
    if (!payload?.label?.length) {
      return;
    }
    this.data = payload;
    this.plan = layout(payload);
    this.ids = payload.label.map((_, i) => String(i));
    this.draw();
  }

  private draw(): void {
    const { label, parent, novel, nG, nA } = this.data;

    this.plotData = [{
      type: 'sunburst',
      ids: this.ids,
      labels: label,
      parents: this.ids.map((_, i) => (i === 0 ? '' : String(parent[i]))),
      values: this.plan.value,
      branchvalues: 'total',
      // the payload is already in segment then natural-name order; Plotly's
      // default would re-sort it by size and scatter the subgroups
      sort: false,
      level: this.ids[this.centre],
      maxdepth: DashRefbookSunburstComponent.RINGS,
      insidetextorientation: 'radial',
      marker: {
        colors: fills(this.data, this.plan, this.drilled),
        line: { color: '#ffffff', width: 0.5 },
      },
      customdata: label.map((_, i) => [
        this.levelOf(i), this.plan.value[i], novel[i], nG[i], nA[i],
      ]),
      hovertemplate:
        '<b>%{label}</b><br>%{customdata[0]}<br><br>'
        + '%{customdata[1]} alleles, %{customdata[2]} novel<br>'
        + 'genomic %{customdata[3]} · AIRR-seq %{customdata[4]}'
        + '<extra></extra>',
    }];

    this.plotLayout = {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      height: 620,
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { size: 12 },
    };
  }

  onPlotClick(event: { points?: { pointNumber?: number }[] }): void {
    const point = event?.points?.[0];
    if (!point || point.pointNumber === undefined) {
      return;
    }
    const i = point.pointNumber;

    if (!this.plan.childCount[i]) {
      // a leaf is an allele, and the dashboard has a panel for those
      this.drill.drill('allele', this.data.label[i]);
      return;
    }

    // clicking the drilled node again steps back out, which is also what Plotly
    // does to the zoom, so the two stay in step
    this.drilled = i === this.drilled ? (this.data.parent[i] || null) : i;
    this.centre = this.drilled ?? 0;
    this.draw();
  }

  resetView(): void {
    this.drilled = null;
    this.centre = 0;
    this.draw();
  }

  get isDrilled(): boolean {
    return this.drilled !== null && this.drilled !== 0;
  }

  /** The drilled node's ancestors, outermost last, node 0 excluded. */
  get trail(): number[] {
    const path: number[] = [];
    for (let i = this.drilled; i !== null && i > 0; i = this.data.parent[i]) {
      path.unshift(i);
    }
    return path;
  }

  drillTo(i: number): void {
    this.drilled = i;
    this.centre = i ?? 0;
    this.draw();
  }

  levelOf(i: number): string {
    return this.data?.levels[this.plan.depth[i]]?.replace(/_/g, ' ') ?? '';
  }
}
