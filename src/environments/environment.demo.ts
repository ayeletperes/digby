// Public read-only demo: the two dashboards only.
//
// `demo` hides the menu entries whose pages need the reports subsystem, the user
// database or the sample BAMs, none of which the demo deployment carries. The
// pages themselves are untouched - this only stops the menu offering them.
//
// location.host rather than location.hostname: the production build assumes a
// proxy on the default port, and the demo may be served on any port.
export const environment = {
  production: true,
  demo: true,
  apiBasePath: location.protocol + '//' + location.host + '/admin/api',
  igvBasePath: location.protocol + '//' + location.host + '/static/study_data/Genomic/samples',
};
