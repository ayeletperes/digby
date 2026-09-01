import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { ascDisplayName } from '../../shared/models/gene-naming';
import { QtlGenotypeCountsComponent } from '../qtl-genotype-counts/qtl-genotype-counts.component';
import {
  QtlAssociation, QtlVariantLookup, usageThreshold,
} from '../../shared/models/qtl-selection.model';

type SortKey = 'asc' | 'neglog10_p' | 'beta' | 'n' | 'min_genotype_group';

/** Genotype classes, written the way the genotype is actually reported. */
const GENOTYPE_LABEL: Record<string, string> = { 0: '0/0', 1: '0/1', 2: '1/1' };

/**
 * One variant, every gene it drives.
 *
 * The scan asks "which variants explain this gene"; this asks the reverse, which
 * is the question someone holding a GWAS hit actually has. Each gene is its own
 * scan, so a variant carries one result per gene and the useful answer is the
 * short list of genes where that result cleared the threshold - with the
 * smallest genotype class beside it, because a p-value resting on one subject is
 * not the same finding as one resting on forty.
 *
 * It has no search box of its own: the variant arrives from the one in the
 * header, which is the only place anything is typed.
 */
@Component({
  selector: 'app-qtl-variant-lookup',
  templateUrl: './qtl-variant-lookup.component.html',
  styleUrls: ['./qtl-variant-lookup.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, QtlGenotypeCountsComponent],
})
export class QtlVariantLookupComponent implements OnChanges {
  /** An ASC written as a gene name; IGH's D clusters already carry the locus. */
  readonly ascName = ascDisplayName;

  @Input() species?: string;
  @Input() variant?: string;

  @Output() drill = new EventEmitter<{ locus: string; variant: string; asc: string }>();
  @Output() resolved = new EventEmitter<{ locus: string; variant: string }>();

  isFetching = false;
  error: string | null = null;
  notFound: string | null = null;

  result: QtlVariantLookup | null = null;

  /** The counting note, behind the site's info control. */
  infoOpen = false;
  /** And what the genotype counts are, behind its own. */
  genotypeInfoOpen = false;


  /** Most genes clear nothing; the whole tested list is a wall of noise. */
  significantOnly = true;
  sortKey: SortKey = 'neglog10_p';
  sortDesc = true;

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['variant'] || changes['species'])
        && this.variant && this.variant !== this.result?.variant?.variant) {
      this.resolve(this.variant);
    }
  }

  /** The threshold this locus was called against, for the caption. */
  get threshold(): number | null {
    return usageThreshold(this.result?.thresholds ?? [])?.threshold ?? null;
  }

  /** The genotype spread, written the way the genotype is reported. */
  get genotypeSpread(): string {
    const counts = this.result?.genotype_counts ?? {};
    return ['0', '1', '2']
      .filter(key => counts[key] !== undefined)
      .map(key => `${GENOTYPE_LABEL[key]} ${counts[key]}`)
      .join(' · ');
  }

  // ------------------------------------------------------------ table filters
  geneSegment = '';
  geneFilter = '';


  /** Segments this variant was actually tested against. */
  get geneSegments(): string[] {
    const order = ['V', 'D', 'J', 'C'];
    const present = new Set((this.result?.associations ?? []).map(a => a.segment));
    return order.filter(x => present.has(x))
      .concat([...present].filter(x => !order.includes(x as string)).sort() as string[]);
  }

  toggleGeneSegment(segment: string): void {
    this.geneSegment = this.geneSegment === segment ? '' : segment;
  }

  get filtersOn(): boolean {
    return !!this.geneSegment || !!this.geneFilter.trim() || this.significantOnly;
  }

  clearFilters(): void {
    this.geneSegment = '';
    this.geneFilter = '';
    this.significantOnly = false;
  }

  /** How many the filters are hiding, so a short table cannot read as a short scan. */
  get totalRows(): number {
    return this.result?.associations?.length ?? 0;
  }

  get rows(): QtlAssociation[] {
    const all = this.result?.associations ?? [];
    const q = this.geneFilter.trim().toUpperCase();
    const kept = all.filter(a =>
      (!this.significantOnly || a.significant)
      && (!this.geneSegment || a.segment === this.geneSegment)
      // matched as stored and as displayed, so "V3" and "IGHV3" find the same
      // genes and IGH's D clusters, which carry the locus, are not a special case
      && (!q || String(a.asc).toUpperCase().includes(q)
             || ascDisplayName(this.result?.locus, a.asc).toUpperCase().includes(q)));
    const direction = this.sortDesc ? -1 : 1;

    return [...kept].sort((a, b) => {
      const left = a[this.sortKey];
      const right = b[this.sortKey];
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction;
      }
      // a missing count sorts last either way rather than reading as zero
      if (left === null || left === undefined) { return 1; }
      if (right === null || right === undefined) { return -1; }
      return ((left as number) - (right as number)) * direction;
    });
  }

  sortBy(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortDesc = !this.sortDesc;
    } else {
      this.sortKey = key;
      // names read naturally ascending, numbers read best strongest-first
      this.sortDesc = key !== 'asc';
    }
  }

  open(association: QtlAssociation): void {
    if (this.result) {
      this.drill.emit({ locus: this.result.locus,
                        variant: this.result.variant.variant,
                        asc: association.asc });
    }
  }

  toggleInfo(): void {
    this.infoOpen = !this.infoOpen;
  }

  toggleGenotypeInfo(): void {
    this.genotypeInfoOpen = !this.genotypeInfoOpen;
  }

  /** Outside links for the identifiers this variant has. */
  get outsideLinks(): { label: string; url: string; title: string }[] {
    const d = (this.result as any)?.dbsnp;
    if (!d?.mapped) {
      return [];
    }
    const links: { label: string; url: string; title: string }[] = [];
    for (const rs of d.rsids as string[]) {
      links.push({ label: rs, url: `https://www.ncbi.nlm.nih.gov/snp/${rs}`,
                   title: `${rs} at dbSNP` });
      // GTEx keys on the rsID, but its variant set does not cover this locus
      // evenly: of five IGH ids sampled, two were present. The link is offered
      // and may land on "not found", which is an answer about GTEx's coverage
      // rather than an error here.
      links.push({ label: 'GTEx', url: `https://gtexportal.org/home/snp/${rs}`,
                   title: `${rs} at GTEx, if GTEx holds it` });
    }
    if (d.grch38) {
      const at = `${d.grch38.contig}:${d.grch38.pos}`;
      links.push({
        label: at,
        url: 'https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position='
             + `${d.grch38.contig}%3A${d.grch38.pos}-${d.grch38.pos}`,
        title: `${at} on GRCh38, at the UCSC browser`,
      });
    }
    return links;
  }


  private resolve(variant: string): void {
    const species = this.species;
    if (!species) {
      return;
    }

    this.isFetching = true;
    this.error = null;
    this.notFound = null;

    this.qtl.variantLookup(species, variant)
      .pipe(catchError(err => {
        this.result = null;
        this.isFetching = false;
        if (err?.status === 404) {
          // only tested variants are held, which is an answer rather than a fault
          this.notFound = variant;
        } else {
          this.error = err?.error?.message ?? err?.message ?? 'Could not look this variant up';
        }
        return of(null);
      }))
      .subscribe(result => {
        if (!result) {
          return;
        }
        this.isFetching = false;
        this.result = result as QtlVariantLookup;
        this.resolved.emit({ locus: this.result.locus,
                             variant: this.result.variant.variant });
      });
  }
}
