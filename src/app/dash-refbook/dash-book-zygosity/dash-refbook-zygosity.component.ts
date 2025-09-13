import { Component, Injectable, Input, OnChanges, SimpleChanges, OnInit, ViewEncapsulation, ViewChild, ElementRef } from '@angular/core';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError, tap } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection } from '../species-gene-selector/species-gene-selector.model';
import { ZygosityData } from './dash-refbook-zygosity.model';
import * as UpSetJS from '@upsetjs/bundle';

@Component({
  selector: 'app-dash-refbook-zygosity',
  templateUrl: './dash-refbook-zygosity.component.html',
  styleUrls: ['./dash-refbook-zygosity.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
})

@Injectable({ providedIn: 'root' })

export class DashRefbookZygosityComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;
  @ViewChild('upsetContainer', { static: false }) upsetContainer!: ElementRef<HTMLDivElement>;



  isFetching = false;
  error = '';
  zygosityData: ZygosityData = { samples: [] };

  private selectionState: any = null;
  private resizeObs?: ResizeObserver;

  constructor(private refbookService: RefbookService) {}

  ngOnInit() {
    this.fetchZygosityData();
  }

  ngAfterViewInit() {
    if ('ResizeObserver' in window) {
      this.resizeObs = new ResizeObserver(() => this.renderUpset());
      this.resizeObs.observe(this.upsetContainer.nativeElement);
    }
    this.renderUpset();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection']) {
      this.fetchZygosityData();
    }
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
  }

  fetchZygosityData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) return;

    this.isFetching = true;
    this.error = '';
    this.zygosityData = { samples: [] };
    this.selectionState = null;

    this.refbookService.getAscZygosity(this.selection.species, this.selection.chain, this.selection.asc)
      .pipe(
        tap(data => console.log('tap:', data)),
        retryWithBackoff(),
        catchError(err => {
          console.error('getAscZygosity ERROR:', err);
          this.error = 'Failed to load zygosity data.';
          this.isFetching = false;
          return EMPTY;
        })
      )
      .subscribe((data: ZygosityData) => {
        console.log(data);
        this.zygosityData = data;
        console.log('Zygosity Data:', data);
        this.isFetching = false;
        this.selectionState = null;
        this.renderUpset();
      });
  }


  private renderUpset() {
    const el = this.upsetContainer?.nativeElement;
    if (!el || !this.zygosityData?.samples?.length) return;
    console.log('Rendering UpSet with data:', this.zygosityData);
    const { sets, combinations } = UpSetJS.extractCombinations(this.zygosityData.samples);

    const rect = el.getBoundingClientRect();
    const width = Math.max(600, rect.width);
    const height = 500;

    const onHover = (set: any) => {
      this.selectionState = set;
      this.renderUpset();
    };

    const props = { sets, combinations, width, height, selection: this.selectionState, onHover };

    el.innerHTML = '';
    UpSetJS.renderUpSet(el, props);
  }
}
