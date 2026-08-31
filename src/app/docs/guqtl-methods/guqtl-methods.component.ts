import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { catchError, forkJoin, of, switchMap } from 'rxjs';

import { QtlService } from '../../dash-qtl/qtl.service';

/** One threshold record, as the ascs endpoint reports it. */
export interface QtlThreshold {
  analysis: string;
  threshold: number;
  neglog10_threshold: number;
  n_subjects: number;
  n_variants: number;
  n_independent: number;
  n_asc: number;
  n_significant_variants: number;
}

/** The thresholds for one species/locus scan, or the reason there are none. */
export interface LocusThresholds {
  species: string;
  locus: string;
  rows: QtlThreshold[];
  /** Set when the scan could not be read; the row is shown, not dropped. */
  error?: string;
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸',
  '9': '⁹',
};

/**
 * Render a p-value threshold in scientific notation.
 *
 * The thresholds run to five significant figures in the API and are not
 * readable at that width; two digits of mantissa is enough to check a p-value
 * against, and the exact value stays in the API response.
 */
export function formatSci(value: number): string {
  if (!isFinite(value) || value === 0) {
    return String(value);
  }
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / Math.pow(10, exponent);
  const digits = String(exponent).split('').map(c => SUPERSCRIPT[c] ?? c).join('');
  return `${mantissa.toFixed(2)} × 10${digits}`;
}

/**
 * Methods for the gene usage QTL scan.
 *
 * The narrative is static, but every number in the threshold table is read from
 * the API at view time. Transcribing them would leave the page asserting the
 * thresholds of whichever dataset happened to be loaded when it was written,
 * and nothing would flag the drift after a reload.
 */
@Component({
  selector: 'app-guqtl-methods',
  templateUrl: './guqtl-methods.component.html',
  styleUrls: ['./guqtl-methods.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class GuqtlMethodsComponent implements OnInit {
  loci: LocusThresholds[] = [];
  isFetching = true;
  /** Set when the locus list itself could not be read. */
  error: string | null = null;

  readonly sci = formatSci;

  constructor(private qtl: QtlService) {}

  ngOnInit(): void {
    // The locus list comes from the API rather than a constant here, so a locus
    // the server withholds is simply absent instead of rendering an empty row,
    // and one that is later published appears without a code change.
    this.qtl.speciesAndLoci().pipe(
      switchMap(({ species, loci }) => {
        const pairs = (species || []).flatMap(
          s => (loci?.[s] || []).map(locus => ({ species: s, locus })));

        if (!pairs.length) {
          return of([] as LocusThresholds[]);
        }

        return forkJoin(pairs.map(pair =>
          this.qtl.ascs(pair.species, pair.locus).pipe(
            // One unreadable locus must not blank the whole table.
            catchError(() => of(null)),
            switchMap(response => of<LocusThresholds>({
              ...pair,
              rows: response?.thresholds ?? [],
              error: response ? undefined : 'Scan could not be read.',
            })),
          )));
      }),
      catchError(() => {
        this.error = 'The guQTL scans could not be reached, so the thresholds ' +
                     'below are not available.';
        return of([] as LocusThresholds[]);
      }),
    ).subscribe(loci => {
      this.loci = loci;
      this.isFetching = false;
    });
  }

  /** True when a locus row has neither thresholds nor an explicit failure. */
  isEmpty(locus: LocusThresholds): boolean {
    return !locus.error && !locus.rows.length;
  }
}
