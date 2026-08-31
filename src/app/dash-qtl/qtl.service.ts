import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * The guQTL endpoints.
 *
 * Hand-written rather than generated: the checked-in swagger definition does not
 * describe these, and the documented codegen would overwrite the refbook client
 * that is also hand-maintained.
 */
@Injectable({ providedIn: 'root' })
export class QtlService {
  private readonly base = `${environment.apiBasePath}/qtl`;

  constructor(private http: HttpClient) {}

  speciesAndLoci(): Observable<{ species: string[]; loci: Record<string, string[]> }> {
    return this.http.get<any>(`${this.base}/species_and_loci`);
  }

  ascs(species: string, locus: string): Observable<any> {
    return this.http.get<any>(`${this.base}/ascs/${enc(species)}/${enc(locus)}`);
  }

  manhattan(species: string, locus: string, asc?: string): Observable<any> {
    let params = new HttpParams();
    if (asc) {
      params = params.set('asc', asc);
    }
    return this.http.get<any>(`${this.base}/manhattan/${enc(species)}/${enc(locus)}`, { params });
  }

  variant(species: string, locus: string, variant: string): Observable<any> {
    return this.http.get<any>(
      `${this.base}/variant/${enc(species)}/${enc(locus)}/${enc(variant)}`);
  }

  /**
   * Resolve a bare variant id to its locus and every ASC it was tested against.
   *
   * Separate from `variant()` because the caller here has only the id: someone
   * arriving from a GWAS hit does not know which locus holds it.
   */
  variantLookup(species: string, variant: string): Observable<any> {
    return this.http.get<any>(`${this.base}/variant_lookup/${enc(species)}/${enc(variant)}`);
  }

  /**
   * Resolve a typed query across every locus.
   *
   * `kind` narrows it to one side: each half of the dashboard asks only about
   * its own thing, so the other scan is not run.
   */
  search(species: string, q: string, kind?: 'variant' | 'gene'): Observable<any> {
    let params = new HttpParams().set('q', q);
    if (kind) {
      params = params.set('kind', kind);
    }
    return this.http.get<any>(`${this.base}/search/${enc(species)}`, { params });
  }

  /**
   * The annotated neighbourhood of one variant.
   *
   * `asc` narrows the neighbouring variants to one scan; without it each is
   * drawn at its own strongest result, which is the only honest summary when no
   * single gene has been chosen.
   */
  region(species: string, locus: string, variant: string, window: number,
         asc?: string, range?: { start: number; end: number } | null): Observable<any> {
    let params = new HttpParams().set('window', String(window));
    if (asc) {
      params = params.set('asc', asc);
    }
    // an explicit range is what a drag on the track produces, and it wins: it is
    // not generally centred on the variant, so it cannot be said as a window
    if (range) {
      params = params.set('start', String(range.start)).set('end', String(range.end));
    }
    return this.http.get<any>(
      `${this.base}/region/${enc(species)}/${enc(locus)}/${enc(variant)}`, { params });
  }

  variantUsage(species: string, locus: string, variant: string, asc: string): Observable<any> {
    return this.http.get<any>(
      `${this.base}/variant_usage/${enc(species)}/${enc(locus)}/${enc(variant)}`,
      { params: new HttpParams().set('asc', asc) });
  }
}

function enc(value: string): string {
  return encodeURIComponent(String(value));
}
