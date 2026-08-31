import {
  ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { environment } from '../../../environments/environment';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { SpeciesGeneSelection, sourcesParam } from '../../shared/models/species-gene-selection.model';
import { DashDrillService } from '../dash-drill.service';
import { fills, layout, SunburstLayout, SunburstPayload } from './sunburst-layout';

/**
 * The locus as a sunburst: chain, gene type, subgroup, ASC, allele.
 *
 * One request per species and locus, and nothing after that - drilling is a
 * recolour of arcs that are already in the DOM. The arcs are plain SVG paths
 * with no text: a chart library that labels every arc spends seconds measuring
 * text for a few thousand alleles, which is the whole reason this is hand-rolled.
 */
@Component({
  selector: 'app-dash-refbook-sunburst',
  templateUrl: './dash-refbook-sunburst.component.html',
  styleUrls: ['./dash-refbook-sunburst.component.scss'],
  standalone: true,
  imports: [CommonModule],
  // the arc and fill arrays are rebuilt wholesale rather than mutated, so there
  // is nothing for Angular to find by walking them on every tick
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashRefbookSunburstComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error: string = null;

  data: SunburstPayload = null;
  /** One `d` string per node. Built once per payload; a drill never touches it. */
  arcs: string[] = [];
  /** Fill per node. The only thing a drill recomputes. */
  fill: string[] = [];

  private plan: SunburstLayout = null;

  /** Node the colours are keyed to, or null for the whole locus. */
  drilled: number = null;
  /** Node under the pointer, shown in the readout. */
  hover: number = null;

  constructor(private http: HttpClient,
              private drill: DashDrillService,
              private cdr: ChangeDetectorRef) {}

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
      this.cdr.markForCheck();
      return;
    }

    let params = new HttpParams();
    const sources = sourcesParam(this.selection);
    if (sources) {
      params = params.set('sources', sources);
    }

    this.isFetching = true;
    this.error = null;
    this.cdr.markForCheck();

    const url = `${environment.apiBasePath}/refbook/sunburst/`
      + `${encodeURIComponent(species)}/${encodeURIComponent(locus)}`;

    this.http.get<SunburstPayload>(url, { params })
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = err?.message ?? String(err);
          this.isFetching = false;
          this.reset();
          this.cdr.markForCheck();
          return EMPTY;
        }),
      )
      .subscribe(payload => {
        this.isFetching = false;
        this.load(payload);
        this.cdr.markForCheck();
      });
  }

  private reset(): void {
    this.data = null;
    this.plan = null;
    this.arcs = [];
    this.fill = [];
    this.drilled = null;
    this.hover = null;
  }

  private load(payload: SunburstPayload): void {
    this.reset();
    if (!payload?.label?.length) {
      return;
    }
    this.data = payload;
    this.plan = layout(payload);
    this.arcs = this.plan.arcs;
    this.fill = fills(payload, this.plan, null);
  }

  // --- interaction -------------------------------------------------------
  // One delegated listener on the group rather than one per arc: at a few
  // thousand alleles, per-path event bindings are the cost that matters.

  private indexFrom(event: Event): number {
    const raw = (event.target as HTMLElement)?.getAttribute?.('data-i');
    if (raw === null || raw === undefined) {
      return null;
    }
    const i = +raw;
    return Number.isInteger(i) && i >= 0 && i < this.arcs.length ? i : null;
  }

  onMove(event: Event): void {
    const i = this.indexFrom(event);
    if (i !== this.hover) {
      this.hover = i;
      this.cdr.markForCheck();
    }
  }

  onLeave(): void {
    this.hover = null;
    this.cdr.markForCheck();
  }

  onClick(event: Event): void {
    const i = this.indexFrom(event);
    if (i === null) {
      return;
    }

    if (i === this.drilled) {
      // clicking the drilled ring again steps back out
      this.drillTo(this.data.parent[i] > 0 ? this.data.parent[i] : null);
    } else if (this.plan.childCount[i]) {
      this.drillTo(i);
    } else {
      // a leaf is an allele, and the dashboard has a panel for those
      this.drill.drill('allele', this.data.label[i]);
    }
  }

  drillTo(i: number): void {
    this.drilled = i;
    this.fill = fills(this.data, this.plan, i);
    this.cdr.markForCheck();
  }

  /**
   * The drilled node's ancestors, outermost last. Node 0 is left out: the button
   * before the trail already stands for the whole locus.
   */
  get trail(): number[] {
    const path: number[] = [];
    for (let i = this.drilled; i !== null && i > 0; i = this.data.parent[i]) {
      path.unshift(i);
    }
    return path;
  }

  /** The node the readout describes: hovered, else drilled, else the whole locus. */
  get focus(): number {
    return this.hover ?? this.drilled ?? 0;
  }

  /** chain → gene type → subgroup → asc → allele */
  get levelPath(): string {
    return (this.data?.levels ?? []).map(name => name.replace(/_/g, ' ')).join(' → ');
  }

  get summary(): string {
    return `Sunburst of ${this.data.label[0]}: ${this.alleleCount(0)} alleles across `
      + `${this.data.levels.length} levels (${this.levelPath}). `
      + 'Use the buttons above the chart to move between levels.';
  }

  levelOf(i: number): string {
    return this.data?.levels[this.plan.depth[i]]?.replace(/_/g, ' ') ?? '';
  }

  alleleCount(i: number): number {
    return this.plan?.value[i] ?? 0;
  }

  /** Ring legend: one chip per level, with how many nodes it holds. */
  get ringLegend(): { name: string; count: number; radius: number }[] {
    const payload = this.data;
    if (!payload) {
      return [];
    }
    const n = payload.label.length;
    return payload.levels.map((name, level) => ({
      name: name.replace(/_/g, ' '),
      count: (level + 1 < payload.levels.length ? payload.levelStart[level + 1] : n)
        - payload.levelStart[level],
      radius: level,
    }));
  }
}
