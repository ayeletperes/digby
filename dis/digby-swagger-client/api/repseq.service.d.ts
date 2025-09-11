import { HttpClient, HttpHeaders, HttpResponse, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Configuration } from '../configuration';
import * as i0 from "@angular/core";
export declare class RepseqService {
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
     * Returns the list of datasets available for the selected species
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
     * Returns the inferred genotype (in MiAIRR format) of the specified sample
     *
     * @param species
     * @param subjectName
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getGenotypeApi(species: string, subjectName: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getGenotypeApi(species: string, subjectName: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getGenotypeApi(species: string, subjectName: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list all novel alleles across all datasets
     *
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getNovelsApi(observe?: 'body', reportProgress?: boolean): Observable<any>;
    getNovelsApi(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getNovelsApi(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns details of full-length novel alleles in a single dataset
     *
     * @param species
     * @param dataset
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getNovelsSpApi(species: string, dataset: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getNovelsSpApi(species: string, dataset: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getNovelsSpApi(species: string, dataset: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns information on the selected sample
     *
     * @param species
     * @param dataset
     * @param sample
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSampleInfoApi(species: string, dataset: string, sample: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSampleInfoApi(species: string, dataset: string, sample: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSampleInfoApi(species: string, dataset: string, sample: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of samples in the selected dataset
     *
     * @param species
     * @param dataset
     * @param pageNumber
     * @param pageSize
     * @param filter
     * @param sortBy
     * @param cols
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSamplesApi(species: string, dataset: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSamplesApi(species: string, dataset: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSamplesApi(species: string, dataset: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of sequences in the selected datasets
     *
     * @param species
     * @param dataset
     * @param pageNumber
     * @param pageSize
     * @param filter
     * @param sortBy
     * @param cols
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSequencesApi(species: string, dataset: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSequencesApi(species: string, dataset: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSequencesApi(species: string, dataset: string, pageNumber?: number, pageSize?: number, filter?: string, sortBy?: string, cols?: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of species for which information is held
     *
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSpeciesApi(observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSpeciesApi(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSpeciesApi(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    static ɵfac: i0.ɵɵFactoryDeclaration<RepseqService, [null, { optional: true; }, { optional: true; }]>;
    static ɵprov: i0.ɵɵInjectableDeclaration<RepseqService>;
}
//# sourceMappingURL=repseq.service.d.ts.map