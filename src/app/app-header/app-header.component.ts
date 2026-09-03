import { Component, OnInit, ViewChild } from '@angular/core';
import {debounceTime} from 'rxjs/operators';
import {AuthService} from "../auth/auth.service";
import { Router, RouterLinkActive, RouterLink } from "@angular/router";
import { GeneTableSelection } from '../gene-table-selector/gene-table-selector.model';
import { GeneTableSelectorService } from '../gene-table-selector/gene-table-selector.service';
import { NgbCollapse, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu, NgbDropdownItem } from '@ng-bootstrap/ng-bootstrap';



@Component({
    selector: 'app-header',
    templateUrl: './app-header.component.html',
    styleUrls: ['./app-header.component.css'],
    imports: [NgbCollapse, NgbNav, NgbNavItem, NgbNavItemRole, RouterLinkActive, NgbNavLink, NgbNavLinkBase, RouterLink, NgbDropdown, NgbDropdownToggle, NgbDropdownMenu, NgbDropdownItem]
})

export class AppHeaderComponent implements OnInit {
  public isMenuCollapsed = true;
  public displayLogin = false;
  public displayLogout = false
  public displayProtected = true;
  geneTableServiceSubscription = null;
  @ViewChild('assemblies_present') assemblies_present: boolean = false;

  constructor(private authService: AuthService,
              private router: Router,
              private geneTableService: GeneTableSelectorService) {
  }

  ngOnInit() {
    this.authService.user.subscribe(user => {
        if (!user.appProtected) {
          console.log("app is not protected");
          this.displayLogin = false;
          this.displayLogout = false;
          this.displayProtected = true;
        } else {
          if (!user.accessToken) {
            console.log("protected and no access token");
            this.displayLogin = true;
            this.displayLogout = false;
            this.displayProtected = false;
          } else {
            console.log("protected and we have an access token");
            this.displayLogin = false;
            this.displayLogout = true;
            this.displayProtected = true;
          }
        }
      }
    );

    this.geneTableServiceSubscription = this.geneTableService.source.pipe(debounceTime(1000)).subscribe(
    (sel: GeneTableSelection) => {
      // console.log(`assemblies notified to app-header: ${sel.assemblies}`);
      this.assemblies_present = false;
      if (!sel || sel.assemblies.length > 0) {
        this.assemblies_present = true;
      }

      console.log(`assemblies present: ${this.assemblies_present}`);
    });
  }

  onLogout() {
    this.authService.logout();
    this.router.navigate(['/auth']);
  }
}
