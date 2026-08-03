import {AfterViewInit, Component, OnInit, ViewEncapsulation, input} from '@angular/core';
import { GenomicService, RepseqService } from 'projects/digby-swagger-client';
import { GeneTableSelectorService } from './gene-table-selector.service';
import { retryWithBackoff } from '../shared/retry_with_backoff';
import {catchError, debounceTime} from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { IDropdownSettings, NgMultiSelectDropDownModule } from 'ng-multiselect-dropdown';
import {GeneTableSelection} from './gene-table-selector.model';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';


@Component({
    selector: 'app-gene-table-selector',
    templateUrl: './gene-table-selector.component.html',
    styleUrls: ['./gene-table-selector.component.css'],
    encapsulation: ViewEncapsulation.None,
    imports: [FormsModule, NgMultiSelectDropDownModule]
})

export class GeneTableSelectorComponent implements OnInit, AfterViewInit {
  readonly showGenomic = input<boolean>(undefined);
  readonly showAssembly = input<boolean>(undefined);
  readonly showRepseq = input<boolean>(undefined);
  readonly showCommon = input<boolean>(undefined);
  species = null;
  selectedSpecies = null;
  notifiedUpdates =  { species: false, refSeq: false, repSeq: false, assemblies: false, common: false };
  datasets: { id: number, text: string }[] = [];
  assemblies: { id: number, text: string }[] = [];
  repSeqs: { id: number, text: string }[] = [];
  singleSelectedGen: { id: number, text: string } = null;
  selectedGen: { id: number, text: string }[] = [];
  genDatasetDescriptions: { dataset: string, description: string }[] = [];
  selectedAssembly: { id: number, text: string }[] = [];
  singleSelectedRep: { id: number, text: string } = null;
  selectedRep: { id: number, text: string }[] = [];
  repDatasetDescriptions: { dataset: string, description: string }[] = [];
  commonDatasets: { id: number, text: string }[] = [];
  singleSelectedCommon: { id: number, text: string } = null;
  selectedCommon: { id: number, text: string }[] = [];
  isFetching: boolean;
  initializing = false;
  error = null;
  geneTableServiceSubscription = null;
<<<<<<< HEAD
=======
  params = null;

  genDropdownSettings: IDropdownSettings = {
    singleSelection: false,
    idField: 'id',
    textField: 'text',
    selectAllText: 'Select All',
    unSelectAllText: 'UnSelect All',
    itemsShowLimit: 3,
    allowSearchFilter: true
  };
>>>>>>> master

  genAssemblyDropdownSettings: IDropdownSettings = {
    singleSelection: true,
    idField: 'id',
    textField: 'text',
    selectAllText: 'Select All',
    unSelectAllText: 'UnSelect All',
    itemsShowLimit: 3,
    allowSearchFilter: true
  };


  constructor(private genomicService: GenomicService,
              private repseqService: RepseqService,
              private geneTableService: GeneTableSelectorService,
              private route: ActivatedRoute
            ) {
    this.route.params.subscribe((params) => {
      this.params = params;

      // If we have URL params, override the default BehaviorSubject value immediately
      if (params.species && params.dataset) {
        console.log("GeneTableSelectorComponent: Route params detected", params.species, params.dataset);
        this.geneTableService.selection.next({
          species: params.species,
          datasets: [],
          genDatasetDescriptions: [],
          assemblies: [],
          repSeqs: [params.dataset],
          repDatasetDescriptions: [],
        });
      }
    });
  }

  ngOnInit() {
    this.isFetching = true;

  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      // this does the heavy work of keeping the selectors on each active page in sync.
      // note that the *active* selector will have its choices updated on the fly. The others rely on this event.
      this.geneTableServiceSubscription = this.geneTableService.source
        .pipe(debounceTime(500)).subscribe(
          (sel: GeneTableSelection) => {
            console.log("GeneTableSelectorComponent received selection:", sel.species, sel.datasets[0], sel.repSeqs[0]);
            if (!this.species) {
              this.initializing = true;
              this.updateSpecies(sel);

            } else if (sel.species && (!this.selectedSpecies || sel.species !== this.selectedSpecies.name)) {
              this.selectedSpecies = this.species.filter((s) => s.name === sel.species)[0];

              this.updateGen(sel.datasets);
              this.updateRep(sel.repSeqs);
              // if the genomic locus has changed, we need to update the genomic and assembly choices
            } else if (sel.datasets && symmetricDifference(new Set(sel.datasets), new Set(this.selectedGen.map((x) => (x.text)))).size) {
              this.selectedGen = this.datasets.filter((r) => sel.datasets.indexOf(r.text) >= 0);
              this.singleSelectedGen = this.selectedGen[0];
              this.updateAssemblies(sel.assemblies);

            } else {
              if (sel.repSeqs && symmetricDifference(new Set(sel.repSeqs), new Set(this.selectedRep.map((x) => (x.text)))).size) {
                this.selectedRep = this.repSeqs.filter((r) => sel.repSeqs.indexOf(r.text) >= 0);
                this.singleSelectedRep = this.selectedRep[0];
              }

              if (sel.assemblies && symmetricDifference(new Set(sel.assemblies), new Set(this.selectedAssembly.map((x) => (x.text)))).size) {
                this.selectedAssembly = this.assemblies.filter((r) => sel.assemblies.indexOf(r.text) >= 0);
              }
            }

            // not sure why this is needed, but if we have some assembly choices and none are selected, select exactly one
            if (this.assemblies.length > 0 && (!this.selectedAssembly || (this.selectedAssembly.length != 1))) {
              this.selectedAssembly.push(this.assemblies[0]);
              console.log("1");
            }
          }
        );
    });

  }

  updateSpecies(selection) {
    console.log("updating species selection in GeneTableSelectorComponent");
    this.genomicService.getSpeciesApi()
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.isFetching = false;
          this.error = err;
          return EMPTY;
        })
      )
      .subscribe((resp) => {
      this.isFetching = false;
      let id = 1;
      this.species = [];
      for (const sp of resp) {
        const sel = {id, name: sp};
        this.species.push(sel);
        if (sp.toLowerCase() === selection.species.toLowerCase()) {
          this.selectedSpecies = sel;
        }

      console.log("in updateSpecies: Selected species:", this.selectedSpecies);

      this.updateGen(selection.datasets);
      this.updateRep(selection.repSeqs);
    }, error => {
      this.isFetching = false;
      this.error = error.message;
    });
  }

  updateGen(selectedNames: string[]) {
    this.genomicService.getDataSetApi(this.selectedSpecies.name)
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.isFetching = false;
          this.error = err;
          return EMPTY;
        })
      )
      .subscribe({
        next: (resp) => {
          this.isFetching = false;
          this.datasets = [];
          this.selectedGen = [];
          this.genDatasetDescriptions = resp;

          let id = 1;
          for (const ref of resp) {
            this.datasets.push({id, text: ref.dataset});

            if (selectedNames && selectedNames.indexOf(ref.dataset) >= 0) {
              this.selectedGen.push({id, text: ref.dataset});
            }

            id = id + 1;
          }

          if (this.selectedGen.length === 0 && this.datasets.length > 0) {
            this.selectedGen.push(this.datasets[0]);
          }

          this.addToCommon(this.datasets);

          if (this.selectedGen.length > 0) {
            // Find the exact object reference from datasets that matches selectedGen
            const matchingDataset = this.datasets.find(r =>
              r.text === this.selectedGen[0].text
            );
            this.singleSelectedGen = matchingDataset || this.selectedGen[0];
          }

          this.notifiedUpdates.refSeq = true;

          this.updateAssemblies(this.geneTableService.selection.value.assemblies);
          this.onSelectionChange();
        },
        error: (error) => {
            this.isFetching = false;
            this.error = error.message;
        }
      });
  }

  updateAssemblies(selectedNames: string[]) {
    if (this.selectedGen.length > 0) {
      this.genomicService.getAssemblyApi(this.selectedSpecies.name, this.selectedGen.map(x => x.text).join())
        .pipe(
          retryWithBackoff(),
          catchError(err => {
            this.isFetching = false;
            this.error = err;
            return EMPTY;
          })
        )
        .subscribe({
          next: (resp) => {
            this.isFetching = false;
            this.assemblies = [];
            this.selectedAssembly = [];

            let id = 1;
            for (const ref of resp) {
              this.assemblies.push({id, text: ref.assembly});

              if (selectedNames && selectedNames.indexOf(ref.ref_seq) >= 0) {
                this.selectedAssembly.push({id, text: ref.dataset});
              }

              id = id + 1;
            }

            if (this.selectedAssembly.length === 0 && this.assemblies.length > 0) {
              this.selectedAssembly.push(this.assemblies[0]);
            }

            if (this.assemblies.length === 0) {

            } else {
              this.notifiedUpdates.assemblies = true;
              this.onSelectionChange();
            }

          },
          error: (error) => {
            this.isFetching = false;
            this.error = error.message;
          }
      });
    } else {
      this.assemblies = [];
      this.selectedAssembly = [];
    }

    this.onSelectionChange();
    this.notifiedUpdates.assemblies = true;
  }


  updateRep(selectedNames: string[]) {
    this.repseqService.getDataSetApi(this.selectedSpecies.name)
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.isFetching = false;
          this.error = err;
          return EMPTY;
        })
      )
      .subscribe({
        next: (resp) => {
          this.isFetching = false;
          this.repSeqs = [];
          this.selectedRep = [];
          this.repDatasetDescriptions = resp;

          let id = 1;
          for (const ref of resp) {
            const dsName = ref.dataset;
            this.repSeqs.push({id, text: dsName});

            if (selectedNames.indexOf(dsName) >= 0) {
              this.selectedRep.push({id, text: dsName});
            }

            id = id + 1;
          }

          if (this.selectedRep.length === 0 && this.repSeqs.length > 0) {
            this.selectedRep.push(this.repSeqs[0]);
          }

          this.addToCommon(this.repSeqs);

          if (this.selectedRep.length > 0) {
            // Find the exact object reference from repSeqs that matches selectedRep
            const matchingRepSeq = this.repSeqs.find(r =>
              r.text === this.selectedRep[0].text
            );
            this.singleSelectedRep = matchingRepSeq || this.selectedRep[0];
          }

          this.notifiedUpdates.repSeq = true;
          this.onSelectionChange();
      },
      error: (error) => {
            this.isFetching = false;
            this.error = error.message;
      }
   });
  }

  addToCommon(recs: { id: number, text: string }[]) {
    const currentVals = this.commonDatasets.map(x => x.text);
    for (const r of recs) {
      if (currentVals.indexOf(r.text) < 0) {
        this.commonDatasets.push({ id: this.commonDatasets.length + 1, text: r.text });
      }
    }

    if ((this.selectedCommon.length === 0 && this.commonDatasets.length > 0)) {
      this.singleSelectedCommon = this.commonDatasets[0];
      this.selectedCommon = [this.singleSelectedCommon];
    }
  }


  handleError(error: HttpErrorResponse) {
    this.isFetching = false;
    this.error = error.message;
  }

  speciesChange() {
    this.notifiedUpdates.species = true;
    this.selectedGen = [];
    this.selectedRep = [];
    this.selectedAssembly = [];
    this.selectedCommon = [];
    this.commonDatasets = [];

    this.updateGen([]);
    this.updateRep([]);
  }

  repSeqChange() {
    this.notifiedUpdates.repSeq = true;
    this.selectedRep = [this.singleSelectedRep]
    if (symmetricDifference(new Set(this.geneTableService.selection.value.repSeqs), new Set(this.selectedRep.map((x) => (x.text)))).size || this.initializing) {
      this.onSelectionChange();
    }

    this.initializing = false;  // the flag is a bit of a hack but we need to make sure the descriptions get refreshed the first time through
  }

  assemblyChange() {
    this.notifiedUpdates.repSeq = true;
    if (symmetricDifference(new Set(this.geneTableService.selection.value.repSeqs), new Set(this.selectedAssembly.map((x) => (x.text)))).size || this.initializing) {
      this.onSelectionChange();
    }

    this.initializing = false;  // the flag is a bit of a hack but we need to make sure the descriptions get refreshed the first time through
  }

  refSeqChange() {
    this.notifiedUpdates.refSeq = true;
    this.selectedGen = [this.singleSelectedGen]
    if (symmetricDifference(new Set(this.geneTableService.selection.value.datasets), new Set(this.selectedGen.map((x) => (x.text)))).size) {
      this.updateAssemblies([]);
      this.onSelectionChange();
    }
  }

  commonChange() {
    this.notifiedUpdates.common = true;
    this.selectedCommon = [this.singleSelectedCommon]
    if (symmetricDifference(new Set(this.geneTableService.selection.value.commonDatasets), new Set(this.selectedCommon.map((x) => (x.text)))).size || this.initializing) {
      this.onSelectionChange();
    }
  }

  onSelectionChange() {
    // if the species has changed, don't notify an update until we have updates to the other selections
    if (this.notifiedUpdates.species) {
      if ((!this.notifiedUpdates.repSeq) || (!this.notifiedUpdates.refSeq)  || (!this.notifiedUpdates.assemblies)) {
        return;
      }
    }

    console.log("onSelectionChange", this.selectedSpecies);

    if (this.selectedSpecies) {
      this.notifiedUpdates = { species: false, refSeq: false, repSeq: false, assemblies: false, common: false };

      this.geneTableService.selection.next({
        species: this.selectedSpecies.name,
        datasets: this.selectedGen.map(x => x.text),
        genDatasetDescriptions: this.genDatasetDescriptions,
        assemblies: this.selectedAssembly.map(x => x.text),
        repSeqs: this.selectedRep.map(x => x.text),
        repDatasetDescriptions: this.repDatasetDescriptions,
        commonDatasets: this.selectedCommon.map(x => x.text)
      });
    }
  }
}

function symmetricDifference(setA, setB) {
    const difference = new Set(setA);
    for (const elem of setB) {
        if (difference.has(elem)) {
            difference.delete(elem);
        } else {
            difference.add(elem);
        }
    }
    return difference;
}
