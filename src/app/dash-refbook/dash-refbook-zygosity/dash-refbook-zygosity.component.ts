import {
  AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import * as UpSetJS from '@upsetjs/bundle';

import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { SpeciesGeneSelection, projectsParam, samplesParam, allelesParam }
  from '../../shared/models/species-gene-selection.model';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { ZygosityData } from './dash-refbook-zygosity.model';

/** Rough width of one character of the set label at its font size. */
const LABEL_CHAR_PX = 6.2;
/** Most of the chart the labels may take before it is widened instead. */
const MAX_LABEL_SHARE = 0.34;
/** Share given to the per-set bar chart, left of the labels. */
const SET_CHART_SHARE = 0.18;

@Component({
  selector: 'app-dash-refbook-zygosity',
  templateUrl: './dash-refbook-zygosity.component.html',
  styleUrls: ['./dash-refbook-zygosity.component.css'],
  standalone: true,
  imports: [CommonModule, ScopeNoteComponent],
})
export class DashRefbookZygosityComponent
  implements OnInit, OnChanges, AfterViewInit, OnDestroy {

  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error = '';
  zygosityData: ZygosityData = { samples: [] };

  private selectionState: unknown = null;
  private resizeObs?: ResizeObserver;
  private renderHandle?: ReturnType<typeof setTimeout>;

  constructor(private refbookService: RefbookService, private host: ElementRef<HTMLElement>,
              private drill: DashDrillService) {}

  /**
   * The chart container.
   *
   * Found from the host rather than with @ViewChild: this component is created
   * through NgComponentOutlet, where the view query was not resolving, leaving
   * every render a no-op against an undefined element.
   */
  private get container(): HTMLDivElement | null {
    return this.host.nativeElement.querySelector('.upset-chart');
  }

  ngOnInit() {
    this.fetchZygosityData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetchZygosityData();
    }
  }

  ngAfterViewInit() {
    const el = this.container;
    if (el && 'ResizeObserver' in window) {
      // UpSet is redrawn imperatively, so resizing during layout can paint the
      // new chart before the old one is cleared; coalesce into one frame
      this.resizeObs = new ResizeObserver(() => this.scheduleRender());
      this.resizeObs.observe(el);
    }
    this.scheduleRender();
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    clearTimeout(this.renderHandle);
  }

  fetchZygosityData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) {
      return;
    }

    this.isFetching = true;
    this.error = '';
    this.zygosityData = { samples: [] };
    this.selectionState = null;

    this.refbookService
      .getAscZygosity(this.selection.species, this.selection.chain, this.selection.asc,
                     projectsParam(this.selection), samplesParam(this.selection),
                     allelesParam(this.selection))
      .pipe(
        retryWithBackoff(),
        catchError(() => {
          this.error = 'Failed to load zygosity data.';
          this.isFetching = false;
          return EMPTY;
        }),
      )
      .subscribe((data: ZygosityData) => {
        this.zygosityData = data;
        this.isFetching = false;
        this.selectionState = null;
        this.scheduleRender();
      });
  }

  private scheduleRender() {
    // Coalesced with a timer rather than requestAnimationFrame: rAF does not fire
    // while the page is not compositing (a background tab, or a hidden pane), which
    // left the chart permanently blank instead of merely late.
    clearTimeout(this.renderHandle);
    this.renderHandle = setTimeout(() => this.renderUpset(), 0);
  }

  private renderUpset() {
    const el = this.container;
    if (!el || !this.zygosityData?.samples?.length) {
      return;
    }

    const width = el.clientWidth;
    if (!width) {
      return;     // laid out in a hidden tab; the observer fires again when shown
    }

    try {
      this.drawUpset(el, width);
    } catch (e) {
      // a render that throws inside the scheduled callback leaves an empty box and
      // no clue why, so surface it rather than failing silently
      this.error = `Could not draw the plot: ${(e as Error)?.message ?? e}`;
      el.innerHTML = '';
    }
  }

  private drawUpset(el: HTMLDivElement, width: number) {
    const { sets, combinations } = UpSetJS.extractCombinations(this.zygosityData.samples);

    // the set list is drawn down the left, so height has to follow it rather than
    // being fixed, or the rows overlap once a gene has more than a few alleles
    const height = Math.min(720, Math.max(280, 180 + sets.length * 22));

    // Allele names are long (IGHV1-2*02_c135t and worse), and the default label
    // column is 19% of the width, which truncates them. Size it from the longest
    // name instead, and widen the chart rather than squeezing the matrix when that
    // leaves too little for it - the container scrolls.
    const longest = sets.reduce((n, set) => Math.max(n, (set.name ?? '').length), 0);
    const labelPx = Math.min(320, Math.max(90, longest * LABEL_CHAR_PX));
    const drawWidth = Math.max(width, Math.round(labelPx / MAX_LABEL_SHARE));
    const labelShare = labelPx / drawWidth;

    el.style.height = `${height}px`;

    el.innerHTML = '';
    UpSetJS.renderUpSet(el, {
      sets, combinations, width: drawWidth, height,
      widthRatios: [SET_CHART_SHARE, labelShare],
      fontSizes: { setLabel: '10px', axisTick: '9px', chartLabel: '11px' },
      selection: this.selectionState as never,
      onHover: (set: unknown) => {
        this.selectionState = set;
        this.scheduleRender();
      },
      // a set is one allele; a combination of one element is a single subject
      onClick: (selected) => {
        const chosen = selected as unknown as
          { name?: string; type?: string; elems?: readonly { name?: string }[] };

        if (chosen?.type === 'set' && chosen.name) {
          this.drill.drill('allele', chosen.name);
        } else if (chosen?.elems?.length === 1 && chosen.elems[0]?.name) {
          this.drill.drill('sample', chosen.elems[0].name);
        }
      },
    });
  }
}
