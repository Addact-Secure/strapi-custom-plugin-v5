const PRIMITIVE_SCALAR_TYPES = [
  'string',
  'text',
  'integer',
  'float',
  'decimal',
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'time',
  'enumeration',
  'email',
  'uid',
];

function isComparableScalarField(attrName, attr) {
  const systemFields = ['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'locale', 'localizations'];
  if (systemFields.includes(attrName)) return false;
  if (!attr) return false;
  return PRIMITIVE_SCALAR_TYPES.includes(attr.type);
}

module.exports = ({ strapi }) => ({
  /**
   * Helper function to build populate parameter dynamically up to maxDepth
   */
  buildPopulateSchema(schema, currentDepth = 0, maxDepth = 4) {
    if (!schema || currentDepth >= maxDepth) return true;
    const populate = {};
    const attributes = schema.attributes || {};

    Object.keys(attributes).forEach((attrName) => {
      // Skip system managed relations that shouldn't be migrated or populated
      if (['createdBy', 'updatedBy', 'localizations'].includes(attrName)) {
        return;
      }

      const attr = attributes[attrName];
      if (attr.type === 'media') {
        populate[attrName] = true;
      } else if (attr.type === 'relation') {
        const targetUid = attr.target;
        const targetSchema = targetUid ? strapi.contentTypes[targetUid] : null;
        if (targetSchema && targetSchema.attributes) {
          const targetAttrs = targetSchema.attributes;
          const fieldsToPopulate = ['documentId'];
          if (targetAttrs.publishedAt) {
            fieldsToPopulate.push('publishedAt');
          }

          // 1. Scan for explicit unique or uid fields
          const uniqueKeys = [];
          Object.keys(targetAttrs).forEach((key) => {
            const field = targetAttrs[key];
            if (isComparableScalarField(key, field)) {
              if (field.unique === true || field.type === 'uid') {
                uniqueKeys.push(key);
              }
            }
          });



          if (uniqueKeys.length > 0) {
            // SCENARIO 1: Unique identifier available
            uniqueKeys.forEach((k) => {
              if (!fieldsToPopulate.includes(k)) fieldsToPopulate.push(k);
            });
          } else {
            // SCENARIO 2: No unique identifier available. Populate all primitive scalar fields.
            Object.keys(targetAttrs).forEach((key) => {
              const field = targetAttrs[key];
              if (isComparableScalarField(key, field)) {
                if (!fieldsToPopulate.includes(key)) fieldsToPopulate.push(key);
              }
            });
          }

          populate[attrName] = { fields: fieldsToPopulate };
        } else {
          populate[attrName] = true;
        }
      } else if (attr.type === 'component') {
        const compSchema = strapi.components[attr.component];
        populate[attrName] = {
          populate: this.buildPopulateSchema(compSchema, currentDepth + 1, maxDepth),
        };
      } else if (attr.type === 'dynamiczone') {
        const dzPopulate = {};
        (attr.components || []).forEach((compName) => {
          const compSchema = strapi.components[compName];
          dzPopulate[compName] = {
            populate: this.buildPopulateSchema(compSchema, currentDepth + 1, maxDepth),
          };
        });
        populate[attrName] = { on: dzPopulate };
      }
    });

    return populate;
  },

  /**
   * Recursively sanitize entry data before exporting
   */
  sanitizeEntry(data, schema) {
    if (!data || typeof data !== 'object') return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeEntry(item, schema));
    }

    const result = {};
    const attributes = schema ? schema.attributes || {} : {};

    // Keep core identifiers and fields
    if (data.documentId) result.documentId = data.documentId;
    if (data.locale) result.locale = data.locale;
    if (data.publishedAt !== undefined) result.publishedAt = data.publishedAt;
    if (data.__component) result.__component = data.__component;

    Object.keys(data).forEach((key) => {
      // Omit auto-generated DB system fields
      if (['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'].includes(key)) {
        return;
      }

      const val = data[key];
      const attr = attributes[key];

      if (!attr) {
        // Dynamic component or raw key
        if (typeof val === 'object' && val !== null) {
          result[key] = this.sanitizeEntry(val, null);
        } else {
          result[key] = val;
        }
        return;
      }

      if (attr.type === 'media') {
        if (Array.isArray(val)) {
          result[key] = val.map((mediaItem) => this.formatMedia(mediaItem));
        } else if (val && typeof val === 'object') {
          result[key] = this.formatMedia(val);
        } else {
          result[key] = null;
        }
      } else if (attr.type === 'relation') {
        if (Array.isArray(val)) {
          result[key] = val.map((rel) => this.formatRelation(rel));
        } else if (val && typeof val === 'object') {
          result[key] = this.formatRelation(val);
        } else {
          result[key] = null;
        }
      } else if (attr.type === 'component') {
        const compSchema = strapi.components[attr.component];
        result[key] = this.sanitizeEntry(val, compSchema);
      } else if (attr.type === 'dynamiczone') {
        if (Array.isArray(val)) {
          result[key] = val.map((dzItem) => {
            const compSchema = strapi.components[dzItem.__component];
            return this.sanitizeEntry(dzItem, compSchema);
          });
        } else {
          result[key] = [];
        }
      } else {
        result[key] = val;
      }
    });

    return result;
  },

  formatMedia(media) {
    if (!media || typeof media !== 'object') return null;
    return {
      name: media.name,
      hash: media.hash,
      ext: media.ext,
      mime: media.mime,
      url: media.url,
      caption: media.caption || '',
      alternativeText: media.alternativeText || '',
    };
  },

  formatRelation(rel) {
    if (!rel || typeof rel !== 'object') return null;
    const result = {};
    Object.keys(rel).forEach((k) => {
      if (!['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'].includes(k)) {
        result[k] = rel[k];
      }
    });
    return result;
  },

  async exportContent(uid, { selectionMode = 'all', selectedDocumentIds = [], start = 0, limit = 1000, fromDate, toDate } = {}) {
    const schema = strapi.contentTypes[uid];
    if (!schema) {
      throw new Error(`Content type ${uid} not found`);
    }

    const populate = this.buildPopulateSchema(schema);
    let rawEntries = [];

    if (schema.kind === 'singleType') {
      const single = await strapi.documents(uid).findFirst({
        populate,
        status: 'draft',
      });
      if (single) {
        rawEntries = [single];
      }
    } else {
      const filters = {};
      if (selectionMode === 'selected' || selectionMode === 'single') {
        if (selectedDocumentIds.length > 0) {
          filters.documentId = { $in: selectedDocumentIds };
        }
      }

      if (fromDate || toDate) {
        filters.createdAt = {};
        if (fromDate) {
          // If fromDate is YYYY-MM-DD, append start of day in UTC
          filters.createdAt.$gte = fromDate.includes('T') ? fromDate : `${fromDate}T00:00:00.000Z`;
        }
        if (toDate) {
          // If toDate is YYYY-MM-DD, append end of day in UTC
          filters.createdAt.$lte = toDate.includes('T') ? toDate : `${toDate}T23:59:59.999Z`;
        }
      }

      rawEntries = await strapi.documents(uid).findMany({
        filters,
        populate,
        status: 'draft',
        start,
        limit,
      });
    }

    const sanitizedData = rawEntries.map((entry) => this.sanitizeEntry(entry, schema));

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      strapiVersion: strapi.config.get('info.strapi') || '5.x',
      contentType: uid,
      kind: schema.kind || 'collectionType',
      displayName: schema.info?.displayName || uid,
      data: schema.kind === 'singleType' ? (sanitizedData[0] || null) : sanitizedData,
    };
  },
});
