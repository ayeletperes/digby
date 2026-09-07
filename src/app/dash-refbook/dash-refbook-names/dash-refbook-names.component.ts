import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';

import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import {
  SpeciesGeneSelection, sourcesParam, projectsParam, samplesParam, allelesParam,
} from '../../shared/models/species-gene-selection.model';
import { nameDifferences, shortenAlleleNames } from '../../shared/models/gene-naming';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { DashDrillService } from '../dash-drill.service';

interface NameRow {
  full: string;
  shown: string;
  shortened: boolean;
  differences: number;
}

/** What the shortened labels stand for. */
@Component({
  selector: 'app-dash-refbook-names',
  templateUrl: './dash-refbook-names.component.html',
  styleUrls: ['./dash-refbook-names.component.css'],
  standalone: true,
  imports: [CommonModule, ScopeNoteComponent],
})
export class DashRefbookNamesComponent implements OnChanges {
  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error: string | null = null;
  rows: NameRow[] = [];

  /** Only the rows whose label differs from the allele's real name. */
  get shortenedRows(): NameRow[] {
    return this.rows.filter(row => row.shortened);
  }

  constructor(private refbookService: RefbookService, private drill: DashDrillService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selection']) {
      this.fetch();
    }
  }

  open(row: NameRow): void {
    this.drill.drill('allele', row.full);
  }

  private fetch(): void {
    const { species, chain, asc } = this.selection ?? {};
    if (!species || !chain || !asc) {
      this.rows = [];
      return;
    }

    this.isFetching = true;
    this.error = null;

    this.refbookService.getAscsOverview(species, chain, asc, sourcesParam(this.selection),
                                        allelesParam(this.selection), projectsParam(this.selection),
                                        samplesParam(this.selection))
      .pipe(retryWithBackoff(), catchError(() => {
        this.error = 'Could not load the allele names.';
        this.isFetching = false;
        return EMPTY;
      }))
      .subscribe((data: { alleles?: string[] }) => {
        const names = data?.alleles ?? [];
        const display = shortenAlleleNames(names);
        this.rows = names.map(full => {
          const shown = display.get(full) ?? full;
          return {
            full, shown,
            shortened: shown !== full,
            // the suffix names each position where this allele differs from
            differences: nameDifferences(full),
          };
        });
        this.isFetching = false;
      });
  }
}
