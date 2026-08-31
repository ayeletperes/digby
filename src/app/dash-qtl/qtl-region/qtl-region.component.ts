import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { QtlSelection, QtlThreshold, usageThreshold } from '../../shared/models/qtl-selection.model';

/**
 * The genomic neighbourhood a selected variant sits in.
 *
 * An association says a variant explains a gene's usage; it does not say what the
 * variant is. This is that: the gene bodies and functional elements around it in
 * their real coordinates, with every other tested variant in the window plotted
 * by significance, so a coding change and a hit 8 kb into intergenic sequence do
 * not look alike.
 *
 * Drawn as SVG in the template rather than with plotly, which is already loaded
 * elsewhere on this page. A genome track is a layout problem, not a charting one:
 * the marks are named rectangles at exact coordinates and every one of them has
 * to hover. Plotly draws rectangles as `shapes`, which do not hover at all, so it
 * would take invisible marker traces laid over the shapes to get the names back -
 * more code than the linear scale below, and a canvas that cannot take the
 * `--vdj-*` tokens the rest of the dashboard is drawn in. SVG `<title>` gives the
 * hover for free.
 *
 * Two rows, because one scale cannot do both jobs. The overview is the window at
 * whatever width was asked for, and dragging across it zooms into that range. The
 * detail below is one gene drawn to its own scale, which is the only way its
 * leader, coding and RSS parts are ever legible: in a 100 kb window a seven-base
 * heptamer is a hundredth of a pixel, so no amount of widening the overview will
 * ever show it.
 */

const VIEW = 1000;          // viewBox width; the SVG scales to its container
const PAD = 6;

const PLOT_TOP = 16;
const PLOT_BOTTOM = 116;    // significance scatter occupies PLOT_TOP..PLOT_BOTTOM
const GENE_Y = 140;
const GENE_H = 9;
const ELEMENT_Y = 160;
const ELEMENT_H = 13;
const AXIS_Y = 190;
export const TRACK_HEIGHT = 214;

/** The gene-model row, which has its own scale and so its own canvas. */
const DETAIL_HEIGHT = 96;
const DETAIL_GENE_Y = 18;
const DETAIL_GENE_H = 10;
const DETAIL_ELEMENT_Y = 40;
const DETAIL_ELEMENT_H = 20;
const DETAIL_AXIS_Y = 74;

/**
 * Mark radius by how many marks are being drawn.
 *
 * At 20 kb a window holds tens of variants and a 3-unit dot is right. At 500 kb
 * it holds thousands, and thousands of 3-unit dots on a 1000-unit axis is one
 * solid bar - the plot stops being a plot, which is what "it broke at 500 kb"
 * was. Every variant is still drawn: the radius shrinks rather than the set,
 * because thinning the crowd would quietly remove exactly the variants whose
 * crowding is the thing worth seeing.
 */
function markRadius(count: number): number {
  return count > 1200 ? 1.1 : count > 400 ? 1.8 : count > 150 ? 2.4 : 3;
}

/** Feature classes, coloured so the leader's three parts read as one thing. */
const FEATURE_COLOUR: Record<string, string> = {
  coding: '#188080',
  leader: '#7cc0bd',
  rss: '#e08a1e',
  utr: '#b0bebd',
  constant: '#6a5acd',
  gene: '#c8d5d4',
};

const FEATURE_LABEL: Record<string, string> = {
  region: 'coding (V-REGION)',
  l_part1: 'leader, exon 1 (L-PART1)',
  leader_intron: 'leader intron',
  l_part2: 'leader, exon 2 (L-PART2)',
  heptamer: 'RSS heptamer',
  spacer: 'RSS spacer',
  nonamer: 'RSS nonamer',
  utr: "5' UTR",
  constant: 'constant region',
};

interface RegionFeature {
  name: string;
  start: number;
  end: number;
  feature: string;
  kind: string;
}

interface RegionVariant {
  variant: string;
  pos: number;
  maf: number | null;
  gene: string | null;
  feature: string | null;
  sub_feature: string | null;
  neglog10_p: number;
  significant: boolean;
  asc: string | null;
  selected: boolean;
}

/** A rectangle already in viewBox units, with the text its tooltip carries. */
interface Box {
  x: number;
  width: number;
  y: number;
  height: number;
  fill: string;
  label: string;
  title: string;
  /** Only wide boxes get their name written on them; the rest rely on hover. */
  showLabel: boolean;
  labelX: number;
}

/**
 * An axis label, with where it hangs from its tick.
 *
 * The first and last labels are centred on ticks that sit on the very edge of
 * the viewBox, so a centred anchor puts half of each outside it and the browser
 * clips them. They anchor inward instead.
 */
interface Tick {
  x: number;
  label: string;
  anchor: 'start' | 'middle' | 'end';
}

interface Mark {
  cx: number;
  cy: number;
  r: number;
  variant: string;
  significant: boolean;
  selected: boolean;
  title: string;
}

@Component({
  selector: 'app-qtl-region',
  templateUrl: './qtl-region.component.html',
  styleUrls: ['./qtl-region.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class QtlRegionComponent implements OnChanges {
  @Input() selection: QtlSelection;
  /** The ASC the clicked point came from, when the scan was a whole-locus one. */
  @Input() fallbackAsc?: string;

  /** Clicking a neighbouring variant selects it, the way a Manhattan point does. */
  @Output() variantPicked = new EventEmitter<string>();

  readonly windows = [2000, 5000, 20000, 100000, 500000];
  window = 20000;

  /**
   * A dragged range, which is not the same thing as a window.
   *
   * A window is centred on the variant; a dragged range is wherever the drag
   * landed, and the variant may be at its edge or outside it entirely. Held apart
   * from `window` so picking a preset afterwards goes back to being centred.
   */
  private range: { start: number; end: number } | null = null;

  /** Genes in the window, kept so a click can rebuild the detail without refetching. */
  private windowGenes: RegionFeature[] = [];
  private windowFeatures: RegionFeature[] = [];

  isFetching = false;
  error: string | null = null;

  /**
   * How to read and drive the track, behind the same info control the reference
   * dashboard uses. It is four lines of instructions and caveats that are true
   * once and then only in the way; the annotation release stays on the face of
   * the panel, because which release the calls came from is not a footnote.
   */
  infoOpen = false;

  contig: string | null = null;
  start = 0;
  end = 0;
  centre = 0;
  annotated = true;
  annotationSource: string | null = null;
  variantCount = 0;
  genesInWindow: string[] = [];

  geneBoxes: Box[] = [];
  elementBoxes: Box[] = [];
  marks: Mark[] = [];
  ticks: Tick[] = [];
  thresholdY: number | null = null;
  yTicks: { y: number; label: string }[] = [];

  // ------------------------------------------------------------ gene detail
  /**
   * The gene whose structure is drawn below, or null.
   *
   * Nothing until a gene is clicked. It used to open on whichever gene was
   * nearest the variant, which for an intergenic hit is a gene several kb away -
   * a zoomed model of something nobody asked about, presented as though it were
   * the subject.
   */
  detailGene: string | null = null;
  detailStart = 0;
  detailEnd = 0;
  detailBoxes: Box[] = [];
  detailGeneBox: Box | null = null;
  detailTicks: Tick[] = [];
  /** Where the selected variant sits in the detail, or null if it is outside. */
  detailVariantX: number | null = null;
  detailNote: string | null = null;
  detailDistance = 0;

  // ------------------------------------------------------------------ brush
  brushFrom: number | null = null;
  brushTo: number | null = null;
  /** Set by a drag, so the click that ends it does not also select a mark. */
  private dragged = false;

  readonly view = VIEW;
  readonly height = TRACK_HEIGHT;
  readonly geneY = GENE_Y;
  readonly geneH = GENE_H;
  readonly elementY = ELEMENT_Y;
  readonly elementH = ELEMENT_H;
  readonly plotTop = PLOT_TOP;
  readonly plotBottom = PLOT_BOTTOM;
  readonly axisY = AXIS_Y;
  readonly pad = PAD;

  readonly detailHeight = DETAIL_HEIGHT;
  readonly detailGeneY = DETAIL_GENE_Y;
  readonly detailGeneH = DETAIL_GENE_H;
  readonly detailElementY = DETAIL_ELEMENT_Y;
  readonly detailElementH = DETAIL_ELEMENT_H;
  readonly detailAxisY = DETAIL_AXIS_Y;

  /** The legend, only for the classes actually on screen. */
  get legend(): { feature: string; colour: string }[] {
    const seen = new Set([...this.elementBoxes, ...this.detailBoxes].map(b => b.fill));
    return Object.entries(FEATURE_COLOUR)
      .filter(([feature, colour]) => feature !== 'gene' && seen.has(colour))
      .map(([feature, colour]) => ({ feature, colour }));
  }

  get plottedAsc(): string | undefined {
    return this.selection?.asc ?? this.fallbackAsc;
  }

  /** The drawn span, in the units a reader thinks in. */
  get spanLabel(): string {
    const size = this.end - this.start;
    return size >= 1000 ? `${(size / 1000).toFixed(size >= 10000 ? 0 : 1)} kb`
                        : `${size} bp`;
  }

  /** True once the view has been dragged away from a plain centred window. */
  get isRanged(): boolean {
    return this.range !== null;
  }

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selection'] || changes['fallbackAsc']) {
      // a different variant is a different neighbourhood, so a range dragged
      // around the previous one means nothing here
      this.range = null;
      this.fetch();
    }
  }

  toggleInfo(): void {
    this.infoOpen = !this.infoOpen;
  }

  setWindow(value: string): void {
    this.window = Number(value);
    this.range = null;
    this.fetch();
  }

  /** Back to the preset window, centred on the variant again. */
  resetView(): void {
    this.range = null;
    this.fetch();
  }

  /** Widen the drawn span about its own middle, the way a zoom-out control does. */
  zoomOut(): void {
    const mid = Math.round((this.start + this.end) / 2);
    const half = Math.max(200, Math.round((this.end - this.start) * 1.25));
    this.range = { start: Math.max(1, mid - half), end: mid + half };
    this.fetch();
  }

  private fetch(): void {
    const { species, locus, variant } = this.selection ?? {};
    if (!species || !locus || !variant) {
      this.clear();
      return;
    }

    this.isFetching = true;
    this.error = null;

    this.qtl.region(species, locus, variant, this.window, this.plottedAsc, this.range)
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? err?.message ?? 'Could not load this region';
        this.isFetching = false;
        this.clear();
        return EMPTY;
      }))
      .subscribe(result => {
        this.isFetching = false;
        this.build(result);
      });
  }

  private clear(): void {
    this.geneBoxes = [];
    this.elementBoxes = [];
    this.marks = [];
    this.ticks = [];
    this.genesInWindow = [];
    this.variantCount = 0;
    this.detailGene = null;
    this.windowGenes = [];
    this.windowFeatures = [];
    this.detailBoxes = [];
    this.detailGeneBox = null;
    this.detailTicks = [];
    this.detailVariantX = null;
    this.detailNote = null;
  }

  /** viewBox x for a position, on a given scale. */
  private scale(pos: number, start: number, end: number): number {
    const span = Math.max(1, end - start);
    return PAD + ((pos - start) / span) * (VIEW - 2 * PAD);
  }

  private x(pos: number): number {
    return this.scale(pos, this.start, this.end);
  }

  private build(result: any): void {
    this.contig = result.contig;
    this.start = result.window.start;
    this.end = result.window.end;
    this.centre = result.window.centre;
    this.annotated = !!result.annotation?.available;
    this.annotationSource = result.annotation?.source ?? null;

    const features: RegionFeature[] = result.features ?? [];
    const genes: RegionFeature[] = result.genes ?? [];
    const variants: RegionVariant[] = result.variants ?? [];

    this.variantCount = variants.length;
    this.genesInWindow = genes.map(g => g.name);

    this.geneBoxes = genes.map(g => this.box(g, GENE_Y, GENE_H,
      FEATURE_COLOUR['gene'], g.name,
      `${g.name}\n${fmt(g.start)}–${fmt(g.end)}  (${fmt(g.end - g.start + 1)} bp)`));
    labelWithoutColliding(this.geneBoxes);

    this.elementBoxes = features.map(f => this.box(f, ELEMENT_Y, ELEMENT_H,
      FEATURE_COLOUR[f.feature] ?? FEATURE_COLOUR['utr'],
      FEATURE_LABEL[f.kind] ?? f.kind,
      `${f.name} · ${FEATURE_LABEL[f.kind] ?? f.kind}\n` +
      `${fmt(f.start)}–${fmt(f.end)}  (${fmt(f.end - f.start + 1)} bp)`));

    // the y scale is the same one the Manhattan uses, and it has to include the
    // threshold even when nothing in this window comes near it, or the line
    // falls off the top and the window looks uniformly significant
    const threshold = usageThreshold((result.thresholds ?? []) as QtlThreshold[]);
    const line = threshold?.neglog10_threshold ?? null;
    const top = Math.max(1, ...variants.map(v => v.neglog10_p), line ?? 0) * 1.08;

    const y = (value: number) =>
      PLOT_BOTTOM - (Math.max(0, value) / top) * (PLOT_BOTTOM - PLOT_TOP);

    this.thresholdY = line === null ? null : y(line);
    this.yTicks = [0, top / 2, top].map(value => ({ y: y(value), label: value.toFixed(0) }));

    const r = markRadius(variants.length);
    this.marks = variants.map(v => ({
      cx: this.x(v.pos),
      cy: y(v.neglog10_p),
      // a fixed 5.5 made the selected mark three times the radius of its
      // neighbours in a crowded window - a blob, not a mark. It grows with the
      // rest instead, enough to find and not enough to hide what is under it.
      r: v.selected ? r + 1.8 : v.significant ? Math.max(2.4, r) : r,
      variant: v.variant,
      significant: v.significant,
      selected: v.selected,
      title: `${v.variant}\n${describe(v)}\n` +
             `-log10 p ${v.neglog10_p.toFixed(2)}${v.asc ? `  (${v.asc})` : ''}` +
             `${v.maf === null ? '' : `\nMAF ${(v.maf * 100).toFixed(1)}%`}`,
    }));
    // significant last, selected last of all: in a crowd the marks worth seeing
    // must not be the ones that happen to be painted over
    this.marks.sort((a, b) => Number(a.selected) - Number(b.selected)
                           || Number(a.significant) - Number(b.significant));

    const step = (this.end - this.start) / 4;
    this.ticks = [0, 1, 2, 3, 4].map(i => {
      const pos = Math.round(this.start + i * step);
      return { x: this.x(pos), label: kb(pos), anchor: anchorFor(i, 4) };
    });

    this.windowGenes = genes;
    this.windowFeatures = features;
    // a gene that has left the window cannot keep its detail row open
    if (this.detailGene && !genes.some(g => g.name === this.detailGene)) {
      this.detailGene = null;
    }
    this.buildDetail();
  }

  /** Open, close or swap the gene whose structure is drawn. */
  showGene(name: string): void {
    if (this.dragged) {
      return;                       // a drag that ends on a gene is a zoom
    }
    this.detailGene = this.detailGene === name ? null : name;
    this.buildDetail();
  }

  closeGene(): void {
    this.detailGene = null;
    this.buildDetail();
  }

  /**
   * One gene drawn to its own scale, which is the only scale its parts survive.
   *
   * Only the gene that was asked for. Which gene is worth looking at is the
   * reader's call: a variant inside a gene and a variant 6 kb from one are
   * different questions, and guessing the second wrongly fills the panel with a
   * gene model nobody wanted.
   */
  private buildDetail(): void {
    this.detailBoxes = [];
    this.detailGeneBox = null;
    this.detailTicks = [];
    this.detailVariantX = null;
    this.detailNote = null;
    this.detailDistance = 0;

    const gene = this.windowGenes.find(g => g.name === this.detailGene);
    if (!gene) {
      return;
    }

    this.detailDistance = this.centre < gene.start ? gene.start - this.centre
                        : this.centre > gene.end ? this.centre - gene.end : 0;

    const own = this.windowFeatures.filter(f => f.name === gene.name);
    // the gene together with its parts: an RSS sits outside the gene body, so the
    // span has to be the union or the heptamer falls off its own detail view
    const lo = Math.min(gene.start, ...own.map(f => f.start));
    const hi = Math.max(gene.end, ...own.map(f => f.end));
    const margin = Math.max(20, Math.round((hi - lo) * 0.08));
    this.detailStart = lo - margin;
    this.detailEnd = hi + margin;

    const at = (pos: number) => this.scale(pos, this.detailStart, this.detailEnd);
    const detailBox = (f: RegionFeature, y: number, h: number,
                       fill: string, label: string, title: string): Box => {
      const left = at(f.start);
      const right = at(f.end + 1);
      const width = Math.max(0.8, right - left);
      return { x: left, width, y, height: h, fill, label, title,
               showLabel: width > label.length * 4.2, labelX: left + width / 2 };
    };

    this.detailGeneBox = detailBox(gene, DETAIL_GENE_Y, DETAIL_GENE_H,
      FEATURE_COLOUR['gene'], gene.name,
      `${gene.name}\n${fmt(gene.start)}–${fmt(gene.end)}  ` +
      `(${fmt(gene.end - gene.start + 1)} bp)`);

    this.detailBoxes = own.map(f => detailBox(f, DETAIL_ELEMENT_Y, DETAIL_ELEMENT_H,
      FEATURE_COLOUR[f.feature] ?? FEATURE_COLOUR['utr'],
      FEATURE_LABEL[f.kind] ?? f.kind,
      `${f.name} · ${FEATURE_LABEL[f.kind] ?? f.kind}\n` +
      `${fmt(f.start)}–${fmt(f.end)}  (${fmt(f.end - f.start + 1)} bp)`));

    if (this.centre >= this.detailStart && this.centre <= this.detailEnd) {
      this.detailVariantX = at(this.centre);
    }

    const step = (this.detailEnd - this.detailStart) / 4;
    this.detailTicks = [0, 1, 2, 3, 4].map(i => {
      const pos = Math.round(this.detailStart + i * step);
      return { x: at(pos), label: fmt(pos), anchor: anchorFor(i, 4) };
    });

    if (!own.length && this.annotated) {
      // the endpoint only returns features overlapping the window, so a gene at
      // the very edge can arrive without its parts. Said out loud, because an
      // empty detail row otherwise reads as "this gene has no annotated
      // structure", which is a different claim entirely.
      this.detailNote = `No annotated parts of ${gene.name} fall inside the `
        + 'drawn window; widen it to see its structure.';
    }
  }

  private box(f: RegionFeature, y: number, height: number,
              fill: string, label: string, title: string): Box {
    // clipped to the window: a gene can start before it and end after it.
    // `end` is inclusive, so the box runs to the far side of that base - drawing
    // to x(end) instead stops one base short and leaves a visible gap at every
    // join between two elements that are in fact contiguous.
    const left = this.x(Math.max(f.start, this.start));
    const right = this.x(Math.min(f.end, this.end) + 1);
    const width = Math.max(0.8, right - left);   // a 7 bp heptamer is sub-pixel
    return {
      x: left, width, y, height, fill, label, title,
      // an element label is written inside its own block, so it has to fit
      showLabel: width > label.length * 4.4,
      labelX: left + width / 2,
    };
  }

  get selectedX(): number {
    return this.x(this.centre);
  }

  pick(variant: string): void {
    // a drag that happens to finish over a mark is a zoom, not a selection
    if (this.dragged || variant === this.selection?.variant) {
      return;
    }
    this.variantPicked.emit(variant);
  }

  // ------------------------------------------------------------------ brush

  /** Drag across the track to zoom into that range, as a genome browser does. */
  onBrushStart(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.dragged = false;
    this.brushFrom = this.toView(event);
    this.brushTo = this.brushFrom;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }

  onBrushMove(event: PointerEvent): void {
    if (this.brushFrom === null) {
      return;
    }
    this.brushTo = this.toView(event);
    if (Math.abs(this.brushTo - this.brushFrom) > 3) {
      this.dragged = true;
    }
  }

  onBrushEnd(): void {
    const from = this.brushFrom;
    const to = this.brushTo;
    this.brushFrom = this.brushTo = null;

    if (from === null || to === null || !this.dragged) {
      this.dragged = false;      // a plain click is not a zoom; let it through
      return;
    }

    const lo = this.toPos(Math.min(from, to));
    const hi = this.toPos(Math.max(from, to));
    // the click this drag ends with arrives after it, so `dragged` is dropped a
    // tick later rather than here, or that click would select whatever it landed on
    setTimeout(() => (this.dragged = false));

    if (hi - lo >= 50) {         // anything smaller is a flick, not a range
      this.range = { start: lo, end: hi };
      this.fetch();
    }
  }

  /** Client pixels to viewBox units, which is what everything here is drawn in. */
  private toView(event: PointerEvent): number {
    const box = (event.currentTarget as SVGGraphicsElement).getBoundingClientRect();
    return box.width ? ((event.clientX - box.left) / box.width) * VIEW : 0;
  }

  private toPos(viewX: number): number {
    const frac = (viewX - PAD) / (VIEW - 2 * PAD);
    return Math.round(this.start + Math.min(1, Math.max(0, frac)) * (this.end - this.start));
  }

  get brushX(): number {
    return Math.min(this.brushFrom ?? 0, this.brushTo ?? 0);
  }

  get brushWidth(): number {
    return Math.abs((this.brushTo ?? 0) - (this.brushFrom ?? 0));
  }
}

/**
 * Show a gene's name unless it would sit on the previous one's.
 *
 * Gene labels are written *above* the bar, not inside it, so the block's own
 * width is the wrong test: a 500 bp V gene is 25 px wide in a 20 kb window and
 * `IGKV1-17` needs 35, which would suppress the name at the default zoom - the
 * one place it is most wanted. What actually has to fit is the label against its
 * neighbour, so that is what is checked, left to right.
 */
function labelWithoutColliding(boxes: Box[]): void {
  let rightmost = -Infinity;
  for (const box of [...boxes].sort((a, b) => a.labelX - b.labelX)) {
    // 9px type in a 1000-unit viewBox runs about 5.2 units per character. The
    // earlier 4.4 under-measured it, which is why long names touched at 500 kb.
    const half = box.label.length * 2.6;
    box.showLabel = box.labelX - half > rightmost + 2;
    if (box.showLabel) {
      rightmost = box.labelX + half;
    }
  }
}

function describe(v: RegionVariant): string {
  if (!v.gene) {
    return 'no annotated gene';
  }
  const kind = FEATURE_LABEL[v.sub_feature ?? ''] ?? v.feature ?? '';
  return `${kind} · ${v.gene}`;
}

/** Centre a label unless it is the first or last, which would overhang. */
function anchorFor(index: number, last: number): 'start' | 'middle' | 'end' {
  return index === 0 ? 'start' : index === last ? 'end' : 'middle';
}

function fmt(value: number): string {
  return value.toLocaleString('en-US');
}

function kb(pos: number): string {
  return `${(pos / 1000).toFixed(pos > 1e6 ? 0 : 1)} kb`;
}
