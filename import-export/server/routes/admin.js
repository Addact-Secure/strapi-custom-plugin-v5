'use strict';

module.exports = [
  {
    method: 'GET',
    path: '/content-types',
    handler: 'import-export.getContentTypes',
    config: {
      policies: [],
    },
  },
  {
    method: 'GET',
    path: '/entries/:contentType',
    handler: 'import-export.getEntries',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/export',
    handler: 'import-export.exportData',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/preview',
    handler: 'import-export.previewData',
    config: {
      policies: [],
    },
  },
  {
    method: 'POST',
    path: '/import',
    handler: 'import-export.importData',
    config: {
      policies: [],
    },
  },
];
