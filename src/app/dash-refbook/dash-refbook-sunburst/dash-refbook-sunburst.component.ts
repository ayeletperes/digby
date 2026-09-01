import { Component, ElementRef, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { PlotlyModule } from 'angular-plotly.js';

import { environment } from '../../../environments/environment';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { SpeciesGeneSelection } from '../../shared/models/species-gene-selection.model';
import { shortenAlleleNames } from '../../shared/models/gene-naming';
import { DashDrillService } from '../dash-drill.service';
import { collapseGroup, fills, layout, SunburstLayout, SunburstPayload }
  from './sunburst-layout';

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
  /** What each arc is labelled with: short, and stripped of the locus prefix. */
  private display: string[] = [];
  /** The hover text for each node, rendered once per payload. */
  private detail: string[] = [];

  constructor(private http: HttpClient, private drill: DashDrillService,
              private host: ElementRef<HTMLElement>) {}

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
    // no sources: the map draws every allele the locus has in either database,
    // so the Data toggle does not change it
    return [selection?.species, selection?.chain].join('|');
  }

  private fetch(): void {
    const species = this.selection?.species;
    const locus = this.selection?.chain;

    if (!species || !locus) {
      this.reset();
      return;
    }

    this.isFetching = true;
    this.error = null;

    const url = `${environment.apiBasePath}/refbook/sunburst/`
      + `${encodeURIComponent(species)}/${encodeURIComponent(locus)}`;

    this.http.get<SunburstPayload>(url)
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
    this.display = [];
    this.detail = [];
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
    this.labelArcs();
    this.describe();
    this.draw();
  }

  /**
   * Arc labels: short enough to fit, with the full name kept for the hover.
   *
   * Two things are dropped. The locus and segment prefix, because every arc
   * inside V of IGH repeats `IGHV` and the rings above already say it. And the
   * substitution suffix of a novel allele, which reaches 250 characters here - the
   * same rule the rest of the dashboard labels alleles by, so a label means the
   * same thing in the locus map as it does on an axis.
   */
  private labelArcs(): void {
    const { label, levels } = this.data;
    const alleleDepth = levels.length - 1;

    // shortened over the whole locus at once, so a label still names exactly one
    // allele - two alleles of a gene can share a stem and a difference count
    const short = shortenAlleleNames(label.filter((_, i) => this.plan.depth[i] === alleleDepth));

    this.display = label.map((name, i) => {
      const depth = this.plan.depth[i];
      if (depth < 2) {
        return name;                    // the locus and the segment letter
      }
      const prefix = label[0] + label[this.plan.topOf[i]];         // IGH + V
      const base = depth === alleleDepth ? (short.get(name) ?? name) : name;
      const trimmed = base.startsWith(prefix) ? base.slice(prefix.length) : base;
      return collapseGroup(trimmed);
    });
  }

  /**
   * Hover text, written out rather than templated.
   *
   * A leaf and a branch mean different things by the same numbers: on an allele
   * `genomic 1` means it is recorded there, on a gene it is a count of alleles.
   * One template cannot say both, so each node carries its own sentence.
   */
  private describe(): void {
    const { label, parent, levels, novel, nG, nA } = this.data;
    const alleleDepth = levels.length - 1;
    const count = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

    this.detail = label.map((name, i) => {
      const lines = [`<b>${name}</b>`];

      if (this.plan.depth[i] === alleleDepth) {
        lines.push(`allele of ${label[parent[i]]}`, '');
        lines.push(nG[i] && nA[i] ? 'Held in both databases'
                  : nG[i] ? 'Held in the genomic database only'
                  : 'Held in the AIRR-seq database only');
        lines.push(novel[i] ? 'Not in the baseline reference set'
                            : 'In the baseline reference set');
      } else {
        // every number here counts alleles, never samples or subjects, so each
        // line says so: "in the genomic database: 1,023" reads as 1,023 people
        lines.push(this.levelOf(i), '');
        lines.push(`${count(this.plan.value[i], 'allele')} in total`);
        lines.push(`${novel[i].toLocaleString()} of them not in the baseline reference set`);
        lines.push(`${nG[i].toLocaleString()} of them held in the genomic database`);
        lines.push(`${nA[i].toLocaleString()} of them held in the AIRR-seq database`);
      }
      return lines.join('<br>');
    });
  }

  private draw(): void {
    this.plotData = [{
      type: 'sunburst',
      ids: this.ids,
      labels: this.display,
      parents: this.ids.map((_, i) => (i === 0 ? '' : String(this.data.parent[i]))),
      values: this.plan.value,
      branchvalues: 'total',
      // the payload is already in segment then natural-name order; Plotly's
      // default would re-sort it by size and scatter the subgroups
      sort: false,
      level: this.ids[this.centre],
      maxdepth: DashRefbookSunburstComponent.RINGS,
      insidetextorientation: 'radial',
      insidetextfont: { size: 11 },
      marker: {
        colors: fills(this.data, this.plan, this.drilled),
        line: { color: '#ffffff', width: 0.5 },
      },
      customdata: this.detail,
      hovertemplate: '%{customdata}<extra></extra>',
    }];

    this.plotLayout = {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      height: 620,
      paper_bgcolor: 'rgba(0,0,0,0)',
      font: { size: 12 },
      // left to itself Plotly shrinks each label to fit its own arc, so with arcs
      // this uneven the labels come out at a dozen different sizes. One size for
      // all of them, and an arc too narrow for it shows nothing rather than a
      // label too small to read - the hover still names it.
      uniformtext: { mode: 'hide', minsize: 9 },
    };
  }

  /**
   * Put every label in the middle of its own arc.
   *
   * Plotly centres sunburst text on the largest rectangle that fits inside the
   * arc, which for an arc this uneven is nowhere near its middle: the labels
   * drift outward and to one side, differently for every arc. There is no
   * setting for it, so this moves them afterwards.
   *
   * It uses Plotly's own geometry rather than recomputing any: each slice
   * carries `pxmid`, the offset from the centre to its outer edge along its mid
   * angle, and `rpx0`/`rpx1`, its radii. Scaling that offset to the mid radius
   * lands on the middle of the arc, and it stays right through a drill because
   * Plotly rewrites those values when it re-roots. Only the translate is
   * touched; the rotation and the uniform scale are Plotly's.
   *
   * If the shape it reads is ever not there, it leaves every label alone.
   */
  centreLabels(): void {
    const slices = this.host.nativeElement.querySelectorAll('.sunburstlayer .slice');
    let centre: { x: number; y: number } = null;

    slices.forEach(slice => {
      const data = (slice as unknown as { __data__?: { rpx0?: number } }).__data__;
      const path = slice.querySelector('path');
      if (data && data.rpx0 === 0 && path) {
        // the innermost node is a full disc, so its box is centred on the origin
        const box = (path as SVGPathElement).getBBox();
        centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    });
    if (!centre) {
      return;
    }

    slices.forEach(slice => {
      const data = (slice as unknown as {
        __data__?: { rpx0?: number; rpx1?: number; pxmid?: number[] };
      }).__data__;
      const text = slice.querySelector('text');
      if (!text || !data || !data.pxmid || !data.rpx1) {
        return;
      }

      // the middle node has no meaningful angle: it is the centre
      const scale = data.rpx0 ? (data.rpx0 + data.rpx1) / 2 / data.rpx1 : 0;
      const x = centre.x + data.pxmid[0] * scale;
      const y = centre.y + data.pxmid[1] * scale;

      const rest = (text.getAttribute('transform') ?? '').replace(/^translate\([^)]*\)/, '');
      text.setAttribute('transform', `translate(${x},${y})${rest}`);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
    });
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

  /**
   * The gene the map is drilled to, if it is drilled to one.
   *
   * Only the gene ring: a subgroup is not something the other panels take, and
   * an allele already opens its own panel on click.
   */
  get drilledGene(): string {
    if (this.drilled === null || !this.data) {
      return null;
    }
    const geneDepth = this.data.levels.length - 2;
    return this.plan.depth[this.drilled] === geneDepth ? this.data.label[this.drilled] : null;
  }

  /** Hand the drilled gene to the dashboard, which selects it and opens it. */
  openGene(): void {
    if (this.drilledGene) {
      this.drill.drill('gene', this.drilledGene);
    }
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
