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

  /**
   * The project every request is about.
   *
   * Held here rather than threaded through eleven signatures because it
   * qualifies all of them identically and the dashboard chooses it once: these
   * analyses are per project and are never pooled, so there is no view that
   * wants two at a time. The backend refuses to guess when several projects
   * hold a locus, so an unset value is safe while only one is loaded and fails
   * loudly rather than silently once a second is.
   */
  project: string | null = null;

  constructor(private http: HttpClient) {}

  /** Every request carries the chosen project. */
  private p(params = new HttpParams()): HttpParams {
    return this.project ? params.set('project', this.project) : params;
  }

  speciesAndLoci(): Observable<{
    species: string[];
    loci: Record<string, string[]>;
    projects: Record<string, string[]>;
    datasets: { species: string; locus: string; project: string | null }[];
  }> {
    return this.http.get<any>(`${this.base}/species_and_loci`);
  }

  ascs(species: string, locus: string): Observable<any> {
    return this.http.get<any>(`${this.base}/ascs/${enc(species)}/${enc(locus)}`,
                              { params: this.p() });
  }

  manhattan(species: string, locus: string, asc?: string): Observable<any> {
    let params = new HttpParams();
    if (asc) {
      params = params.set('asc', asc);
    }
    return this.http.get<any>(`${this.base}/manhattan/${enc(species)}/${enc(locus)}`,
                              { params: this.p(params) });
  }

  variant(species: string, locus: string, variant: string): Observable<any> {
    return this.http.get<any>(
      `${this.base}/variant/${enc(species)}/${enc(locus)}/${enc(variant)}`,
      { params: this.p() });
  }

  /**
   * Resolve a bare variant id to its locus and every ASC it was tested against.
   *
   * Separate from `variant()` because the caller here has only the id: someone
   * arriving from a GWAS hit does not know which locus holds it.
   */
  variantLookup(species: string, variant: string): Observable<any> {
    return this.http.get<any>(`${this.base}/variant_lookup/${enc(species)}/${enc(variant)}`,
                              { params: this.p() });
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
    return this.http.get<any>(`${this.base}/search/${enc(species)}`,
                              { params: this.p(params) });
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
      `${this.base}/region/${enc(species)}/${enc(locus)}/${enc(variant)}`,
      { params: this.p(params) });
  }

  /**
   * Variants with a partner-pairing scan, strongest first.
   *
   * `conditional` is not optional and has no default: P(J|D) and P(D|J) are two
   * scans over the same variants, so guessing one would make the answer depend
   * on what the caller forgot to say.
   */
  pairingVariants(species: string, locus: string, conditional: string,
                  limit = 200): Observable<any> {
    return this.http.get<any>(
      `${this.base}/pairing_variants/${enc(species)}/${enc(locus)}`,
      { params: this.p(new HttpParams().set('conditional', conditional)
                                       .set('limit', String(limit))) });
  }

  /** One variant's partner distributions, by genotype. */
  pairing(species: string, locus: string, variant: string,
          conditional: string): Observable<any> {
    return this.http.get<any>(
      `${this.base}/pairing/${enc(species)}/${enc(locus)}/${enc(variant)}`,
      { params: this.p(new HttpParams().set('conditional', conditional)) });
  }

  /** Significant variants by locus, segment and where they sit. */
  usageSummary(species: string): Observable<any> {
    return this.http.get<any>(`${this.base}/usage_summary/${enc(species)}`,
                              { params: this.p() });
  }

  /** The same counts split per gene, for one locus. */
  geneSummary(species: string, locus: string): Observable<any> {
    return this.http.get<any>(`${this.base}/gene_summary/${enc(species)}/${enc(locus)}`,
                              { params: this.p() });
  }

  variantUsage(species: string, locus: string, variant: string, asc: string): Observable<any> {
    return this.http.get<any>(
      `${this.base}/variant_usage/${enc(species)}/${enc(locus)}/${enc(variant)}`,
      { params: this.p(new HttpParams().set('asc', asc)) });
  }
}

function enc(value: string): string {
  return encodeURIComponent(String(value));
}
