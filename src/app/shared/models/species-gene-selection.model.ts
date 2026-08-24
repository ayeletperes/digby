/**
 * What the refbook dashboards are currently looking at.
 *
 * `species` and `locus` come from the dataset selector; `sources` is the user's
 * genomic / AIRR-seq choice; `ascs` is the (possibly multiple) gene selection.
 *
 * `chain` and `asc` are the single-selection projection of `locus` and `ascs[0]`.
 * They are kept because every existing panel and its template reads them, and
 * because most panels only ever look at one gene.
 */
export type DataSource = 'genomic' | 'airrseq';

export const DATA_SOURCES: DataSource[] = ['genomic', 'airrseq'];

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  genomic: 'Genomic',
  airrseq: 'AIRR-seq',
};

export class SpeciesGeneSelection {
  species?: string;
  chain?: string;
  asc?: string;

  /** Databases to read. Empty is treated as "all available" by the API. */
  sources?: DataSource[];

  /** Every selected gene. Panels that show one gene use ascs[0], mirrored in asc. */
  ascs?: string[];

  /** AIRR-seq projects to include. Empty or absent means all of them. */
  projects?: string[];

  /** AIRR-seq samples to include. Empty or absent means all of them. */
  samples?: string[];

  /** Alleles to narrow to, set by drilling into a plot. Empty means all. */
  alleles?: string[];

  /**
   * Selected projects split by the database they belong to.
   *
   * The two databases name entirely different studies, so a selection made from
   * one narrows only that one. Panels need this to say what their figures cover
   * rather than implying the whole selection applied.
   */
  projectScope?: { genomic: string[]; airrseq: string[] };
}

/** Which sources a locus actually holds, before the user's choice narrows it. */
export class SourceAvailability {
  genomic = false;
  airrseq = false;
}

/** The species, and the loci available for each, as returned by /refbook/species_and_loci. */
export class AvailableSpeciesAndData {
  species: string[];
  loci: Record<string, string[]>;
}

/** Comma-separated source list for the API, or undefined to let it default to all. */
export function sourcesParam(selection: SpeciesGeneSelection): string | undefined {
  const sources = selection?.sources;
  return sources && sources.length ? sources.join(',') : undefined;
}

/** Comma-separated project list, or undefined for no filtering. */
export function projectsParam(selection: SpeciesGeneSelection): string | undefined {
  const projects = selection?.projects;
  return projects && projects.length ? projects.join(',') : undefined;
}

/** Comma-separated sample list, or undefined for no filtering. */
export function samplesParam(selection: SpeciesGeneSelection): string | undefined {
  const samples = selection?.samples;
  return samples && samples.length ? samples.join(',') : undefined;
}

/** Comma-separated allele list, or undefined for no filtering. */
export function allelesParam(selection: SpeciesGeneSelection): string | undefined {
  const alleles = selection?.alleles;
  return alleles && alleles.length ? alleles.join(',') : undefined;
}

/**
 * One line describing which samples a figure covers, for a panel reading `sources`.
 *
 * Returns null when nothing is narrowed, so a panel showing everything says nothing.
 */
export function scopeNote(selection: SpeciesGeneSelection,
                          sources: DataSource[]): string | null {
  const scope = selection?.projectScope;
  const samples = selection?.samples ?? [];

  const parts: string[] = [];
  for (const source of sources) {
    const projects = scope?.[source] ?? [];
    if (projects.length) {
      parts.push(`${DATA_SOURCE_LABELS[source]}: ${projects.join(', ')}`);
    } else if ((selection?.projects ?? []).length) {
      // a selection exists but none of it belongs to this database
      parts.push(`${DATA_SOURCE_LABELS[source]}: all projects`);
    }
  }

  if (samples.length) {
    parts.push(samples.length === 1 ? `sample ${samples[0]}` : `${samples.length} samples`);
  }

  return parts.length ? parts.join(' · ') : null;
}
