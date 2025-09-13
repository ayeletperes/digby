import { HttpClient, HttpHeaders, HttpResponse, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Configuration } from '../configuration';
import * as i0 from "@angular/core";
export declare class RefbookService {
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
     * Returns sequences of all alleles in an ASC
     *
     * @param species
     * @param chain
     * @param asc
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAscSeqs(species: string, chain: string, asc: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAscSeqs(species: string, chain: string, asc: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAscSeqs(species: string, chain: string, asc: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns usage statistics for all alleles in an ASC
     *
     * @param species
     * @param chain
     * @param asc
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAscUsage(species: string, chain: string, asc: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAscUsage(species: string, chain: string, asc: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAscUsage(species: string, chain: string, asc: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns zygosity statistics for all subjects in a given ASC
     *
     * @param species
     * @param chain
     * @param asc
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAscZygosity(species: string, chain: string, asc: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAscZygosity(species: string, chain: string, asc: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAscZygosity(species: string, chain: string, asc: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of ASCs in a given chain for a given species
     *
     * @param species
     * @param chain
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAscsInChainApi(species: string, chain: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAscsInChainApi(species: string, chain: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAscsInChainApi(species: string, chain: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns data for the overview refbook component
     *
     * @param species
     * @param chain
     * @param asc
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getAscsOverview(species: string, chain: string, asc: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getAscsOverview(species: string, chain: string, asc: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getAscsOverview(species: string, chain: string, asc: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     * Returns the list of species and chains for which information is held
     *
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getSpeciesApi(observe?: 'body', reportProgress?: boolean): Observable<any>;
    getSpeciesApi(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getSpeciesApi(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    static ɵfac: i0.ɵɵFactoryDeclaration<RefbookService, [null, { optional: true; }, { optional: true; }]>;
    static ɵprov: i0.ɵɵInjectableDeclaration<RefbookService>;
}
//# sourceMappingURL=refbook.service.d.ts.map