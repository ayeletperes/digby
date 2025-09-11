import { HttpClient, HttpHeaders, HttpResponse, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Configuration } from '../configuration';
import * as i0 from "@angular/core";
export declare class GenomicService {
    protected httpClient: HttpClient;
    protected basePath: string;
    defaultHeaders: HttpHeaders;
    configuration: Configuration;
    constructor(httpClient: HttpClient, basePath: string, configuration: Configuration);
    /**
     * @param consumes string[] mime-types
     * @return true: consumes contains 'multipart/form-data', false: otherwise
     */
    private canConsumeForm;
    /**
     * Returns information on all samples
     *
     * @param species
     * @param dataset
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAllSamplesInfoApi(species: string, dataset: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAllSamplesInfoApi(species: string, dataset: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAllSamplesInfoApi(species: string, dataset: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Return genotypes for all subjects of the specified species in the specified data type
     *
     * @param species
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAllSubjectsGenotypeApi(species: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAllSubjectsGenotypeApi(species: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAllSubjectsGenotypeApi(species: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of annotated assemblies for the selected species and datasets
     *
     * @param species
     * @param dataSets
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAssemblyApi(species: string, dataSets: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAssemblyApi(species: string, dataSets: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAssemblyApi(species: string, dataSets: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of data sets for the selected species
     *
     * @param species
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getDataSetApi(species: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getDataSetApi(species: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getDataSetApi(species: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns information and statistics on the dataset
     *
     * @param species
     * @param dataset
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getDataSetInfoApi(species: string, dataset: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getDataSetInfoApi(species: string, dataset: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getDataSetInfoApi(species: string, dataset: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the position of the first feature matching the specified string
     *
     * @param species
     * @param dataset
     * @param refSeqName
     * @param featureString
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getFeaturePosApi(species: string, dataset: string, refSeqName: string, featureString: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getFeaturePosApi(species: string, dataset: string, refSeqName: string, featureString: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getFeaturePosApi(species: string, dataset: string, refSeqName: string, featureString: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the inferred genotype (in MiAIRR format) of the specified patient
     *
     * @param species
     * @param patientName
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getGenotypeApi(species: string, patientName: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getGenotypeApi(species: string, patientName: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getGenotypeApi(species: string, patientName: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns nucleotide sequences from selected reference or multiple references (separate multiple reference names with &#39;,&#39;)
     *
     * @param species
     * @param genomicDatasets
     * @param pageNumber
     * @param pageSize
     * @param filter
     * @param sortBy
     * @param cols
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSequencesApi(species: string, genomicDatasets: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSequencesApi(species: string, genomicDatasets: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSequencesApi(species: string, genomicDatasets: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of species for which information is held
     *
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSpeciesApi(observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSpeciesApi(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSpeciesApi(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns information on the selected sample
     *
     * @param species
     * @param dataset
     * @param sampleId
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSubjectInfoApi(species: string, dataset: string, sampleId: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSubjectInfoApi(species: string, dataset: string, sampleId: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSubjectInfoApi(species: string, dataset: string, sampleId: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns a list of subjects in the selected datasets
     *
     * @param species
     * @param genomicDatasets
     * @param pageNumber
     * @param pageSize
     * @param filter
     * @param sortBy
     * @param cols
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSubjectsApi(species: string, genomicDatasets: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSubjectsApi(species: string, genomicDatasets: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSubjectsApi(species: string, genomicDatasets: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    static ɵfac: i0.ɵɵFactoryDeclaration<GenomicService, [null, { optional: true; }, { optional: true; }]>;
    static ɵprov: i0.ɵɵInjectableDeclaration<GenomicService>;
}
//# sourceMappingURL=genomic.service.d.ts.map