import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * How to read the Repertoire & Genome Explorer.
 *
 * Static, unlike the guQTL methods page: nothing here quotes a number out of
 * the loaded database, so there is nothing that can drift when the data is
 * reloaded. Everything it states is a property of the code, and the places
 * where the code is the authority are named so a reader can go and check.
 */
@Component({
  selector: 'app-explorer-guide',
  templateUrl: './explorer-guide.component.html',
  // the article styling belongs to the docs pages as a set, not to the guQTL
  // page that happened to be written first; the second file holds only what
  // this page adds
  styleUrls: ['../guqtl-methods/guqtl-methods.component.scss',
              './explorer-guide.component.scss'],
  standalone: true,
  imports: [RouterLink],
})
export class ExplorerGuideComponent {}
