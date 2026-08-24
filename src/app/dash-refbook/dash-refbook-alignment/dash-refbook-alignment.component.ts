import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { SpeciesGeneSelection, sourcesParam, allelesParam } from '../../shared/models/species-gene-selection.model';

@Component({
  selector: 'app-dash-refbook-alignment',
  templateUrl: './dash-refbook-alignment.component.html',
  styleUrls: ['./dash-refbook-alignment.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class DashRefbookAlignmentComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error: string | null = null;
  alignment = '';
  segment = '';
  codonWrap = 20;
  legend: { label: string; name: string }[] = [];
  showLegend = false;

  readonly wrapOptions = [10, 15, 20, 30, 40];

  constructor(private refbookService: RefbookService) {}

  ngOnInit() {
    this.fetchData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetchData();
    }
  }

  onWrapChange() {
    this.fetchData();
  }

  copyToClipboard() {
    navigator.clipboard?.writeText(this.alignment);
  }

  download() {
    const name = `${this.selection.species}_${this.selection.asc}_alignment.txt`.replace(/[^\w.-]/g, '_');
    const url = URL.createObjectURL(new Blob([this.alignment], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  private fetchData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) {
      this.isFetching = false;
      this.alignment = '';
      return;
    }

    this.isFetching = true;
    this.error = null;

    this.refbookService
      .getAscAlignment(this.selection.species, this.selection.chain, this.selection.asc,
                       this.codonWrap, sourcesParam(this.selection),
                       allelesParam(this.selection))
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = err?.error?.message ?? err?.message ?? 'Could not load the alignment';
          this.isFetching = false;
          this.alignment = '';
          return EMPTY;
        })
      )
      .subscribe((data: { alignment: string; segment: string; legend: Record<string, string> }) => {
        this.isFetching = false;
        this.alignment = data.alignment;
        this.segment = data.segment;
        this.legend = Object.entries(data.legend ?? {}).map(([label, name]) => ({ label, name }));
      });
  }
}
