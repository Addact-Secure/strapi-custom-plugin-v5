'use strict';

module.exports = ({ strapi }) => ({
  async getContentTypes(ctx) {
    try {
      const contentTypes = strapi.plugin('import-export').service('contentTypes').getContentTypes();
      ctx.body = { data: contentTypes };
    } catch (err) {
      ctx.badRequest(err.message);
    }
  },

  async getEntries(ctx) {
    try {
      const { contentType } = ctx.params;
      const { page, pageSize, search, fromDate, toDate } = ctx.query;
      const result = await strapi
        .plugin('import-export')
        .service('contentTypes')
        .getEntriesList(contentType, {
          page: parseInt(page || 1, 10),
          pageSize: parseInt(pageSize || 50, 10),
          search: search || '',
          fromDate,
          toDate,
        });
      ctx.body = { data: result };
    } catch (err) {
      ctx.badRequest(err.message);
    }
  },

  async exportData(ctx) {
    try {
      const { contentType, selectionMode, selectedDocumentIds, start, limit, fromDate, toDate } = ctx.request.body;
      if (!contentType) {
        return ctx.badRequest('contentType parameter is required.');
      }
      const result = await strapi
        .plugin('import-export')
        .service('export')
        .exportContent(contentType, { selectionMode, selectedDocumentIds, start, limit, fromDate, toDate });
      ctx.body = result;
    } catch (err) {
      console.error('--- EXPORT CONTROLLER ERROR ---', err);
      ctx.badRequest(err.message);
    }
  },

  async previewData(ctx) {
    try {
      const { data, matchingKey, publicationStateMode } = ctx.request.body;
      if (!data) {
        return ctx.badRequest('data payload is required.');
      }
      const result = await strapi
        .plugin('import-export')
        .service('preview')
        .previewImport(data, { matchingKey, publicationStateMode });
      ctx.body = { data: result };
    } catch (err) {
      ctx.badRequest(err.message);
    }
  },

  async importData(ctx) {
    try {
      const { data, matchingKey, publicationStateMode } = ctx.request.body;
      if (!data) {
        return ctx.badRequest('data payload is required.');
      }
      const result = await strapi
        .plugin('import-export')
        .service('import')
        .importContent(data, { matchingKey, publicationStateMode });
      ctx.body = { data: result };
    } catch (err) {
      ctx.badRequest(err.message);
    }
  },
});
