import { enableProdMode, provideAppInitializer, inject, importProvidersFrom } from '@angular/core';
import { apiConfigFactory } from './app/app.module';
import { environment } from './environments/environment';
import { RequestCache } from './app/shared/http_cache';
import { AuthService } from './app/auth/auth.service';
import { ReportsService, GenomicService, RepseqService, SystemService, BASE_PATH, Configuration, ConfigurationParameters, ApiModule } from 'projects/digby-swagger-client';
import { ReportRunService } from './app/reports/report-run.service';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CachingInterceptor } from './app/shared/caching_interceptor';
import { AuthInterceptorService } from './app/auth/auth-interceptor.service';
import { RouteReuseStrategy, provideRouter, Routes } from '@angular/router';
import { CustomReuseStrategy } from './app/shared/route-reuse-strategy';
import { appInitializer } from './app/auth/auth.initializer';
import { BrowserModule, bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HomeComponent } from './app/home/home.component';
import { AuthGuard } from './app/auth/auth.guard';
import { RepExploreDataComponent } from './app/rep-explore-data/rep-explore-data.component';
import { RepSampleComponent } from './app/rep-sample/rep-sample.component';
import { RepGeneTableComponent } from './app/rep-gene-table/rep-gene-table.component';
import { GenExploreDataComponent } from './app/gen-explore-data/gen-explore-data.component';
import { GenSampleComponent } from './app/gen-sample/gen-sample.component';
import { GenGeneTableComponent } from './app/gen-gene-table/gen-gene-table.component';
import { GeneBrowserComponent } from './app/gene-browser/gene-browser.component';
import { RefbookComponent } from './app/refbook/refbook.component';
import { DashRefbookComponent } from './app/dash-refbook/dash-refbook.component';
import { ReportsComponent } from './app/reports/reports.component';
import { QuickRefComponent } from './app/home/quick-ref/quick-ref.component';
import { UserGuideComponent } from './app/home/user-guide/user-guide.component';
import { LicensingComponent } from './app/home/licensing/licensing.component';
import { AuthComponent } from './app/auth/auth.component';
import { NgMultiSelectDropDownModule } from 'ng-multiselect-dropdown';
import { FilterModule } from './app/table/filter/filter.module';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatCardModule } from '@angular/material/card';
import { ObserversModule } from '@angular/cdk/observers';
import { ResizableModule } from 'angular-resizable-element';
import { GoogleChartsModule } from 'angular-google-charts';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppComponent } from './app/app.component';

const params: ConfigurationParameters = {
    // set configuration parameters here.
    basePath: environment.apiBasePath,
  };
const appRoutes: Routes = [
  { path: '', component: HomeComponent, canActivate: [AuthGuard] },
  // AIRR-seq menu
  { path: 'datarep', component: RepExploreDataComponent, canActivate: [AuthGuard] },
  { path: 'samplerep/:onlySelectedSamples', component: RepSampleComponent, canActivate: [AuthGuard] },
  { path: 'generep', component: RepGeneTableComponent, canActivate: [AuthGuard] },
  { path: 'generep/:species/:dataset/:alleleName', component: RepGeneTableComponent, canActivate: [AuthGuard] },
  // Genomics menu
  { path: 'datagen', component: GenExploreDataComponent, canActivate: [AuthGuard] },
  { path: 'genesample/:onlySelectedSamples', component: GenSampleComponent, canActivate: [AuthGuard] },
  { path: 'genetable', component: GenGeneTableComponent, canActivate: [AuthGuard] },
  { path: 'genebrowser/:speciesName/:refName', component: GeneBrowserComponent, canActivate: [AuthGuard] },
  // Analysis menu
  { path: 'reference_book/:species', component: RefbookComponent, canActivate: [AuthGuard] },
  { path: 'dash_refbook', component: DashRefbookComponent, canActivate: [AuthGuard] },
  { path: 'reports', component: ReportsComponent, canActivate: [AuthGuard] },
  // Help menu
  { path: 'quick-ref', component: QuickRefComponent, canActivate: [AuthGuard] },
  { path: 'user-guide', component: UserGuideComponent, canActivate: [AuthGuard] },
  { path: 'licensing', component: LicensingComponent, canActivate: [AuthGuard] },
  { path: 'auth', component: AuthComponent },
  { path: '**', component: HomeComponent, canActivate: [AuthGuard] },
];




if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
    providers: [
        importProvidersFrom(BrowserModule, FormsModule, ReactiveFormsModule, NgbModule, MatInputModule, MatTableModule, MatPaginatorModule, MatSortModule, MatProgressSpinnerModule, ApiModule.forRoot(apiConfigFactory), NgMultiSelectDropDownModule.forRoot(), FilterModule, MatIconModule, MatMenuModule, MatCheckboxModule, DragDropModule, MatCardModule, ObserversModule, ResizableModule, GoogleChartsModule, MatTooltipModule),
        RequestCache,
        AuthService,
        ReportsService,
        GenomicService,
        RepseqService,
        SystemService,
        ReportRunService,
        { provide: BASE_PATH, useValue: environment.apiBasePath },
        { provide: HTTP_INTERCEPTORS, useClass: CachingInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptorService, multi: true },
        { provide: RouteReuseStrategy, useClass: CustomReuseStrategy },
        provideAppInitializer(() => {
            const initializerFn = (appInitializer)(inject(AuthService));
            return initializerFn();
        }),
        provideHttpClient(withInterceptorsFromDi()),
        provideAnimations(),
        provideRouter(appRoutes)
    ]
})
  .catch(err => console.error(err));
