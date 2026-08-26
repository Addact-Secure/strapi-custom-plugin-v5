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
  getContentTypes() {
    const contentTypes = [];
    const rawContentTypes = strapi.contentTypes;

    Object.keys(rawContentTypes).forEach((uid) => {
      // Only include user-created content types (custom collection & single types)
      if (!uid.startsWith('api::')) {
        return;
      }

      const contentType = rawContentTypes[uid];
      const attributes = contentType.attributes || {};
      const uniqueKeys = [];
      const matchableFields = ['documentId'];

      // Discover fields marked as unique or common identity fields
      Object.keys(attributes).forEach((attrName) => {
        const attr = attributes[attrName];
        if (!attr) return;

        const isUnique = attr.unique === true || attr.type === 'uid';
        const isScalar = isComparableScalarField(attrName, attr);

        if (isScalar) {
          matchableFields.push(attrName);
          if (isUnique) {
            if (!uniqueKeys.includes(attrName)) {
              uniqueKeys.push(attrName);
            }
          }
        }
      });

      contentTypes.push({
        uid,
        kind: contentType.kind || 'collectionType',
        displayName: contentType.info?.displayName || contentType.info?.singularName || uid,
        singularName: contentType.info?.singularName,
        pluralName: contentType.info?.pluralName,
        description: contentType.info?.description || '',
        uniqueKeys,
        matchableFields,
        attributes: Object.keys(attributes),
      });
    });

    return contentTypes;
  },

  async getEntriesList(uid, { page = 1, pageSize = 50, search = '', fromDate, toDate } = {}) {
    const contentType = strapi.contentTypes[uid];
    if (!contentType) {
      throw new Error(`Content type ${uid} not found`);
    }

    // Single Type handling
    if (contentType.kind === 'singleType') {
      const entry = await strapi.documents(uid).findFirst({
        status: 'draft',
      });
      return {
        entries: entry ? [entry] : [],
        total: entry ? 1 : 0,
        kind: 'singleType',
      };
    }

    // Collection Type handling
    const filters = {};
    if (search) {
      const searchFields = Object.keys(contentType.attributes || {}).filter((key) =>
        ['string', 'text', 'uid', 'email'].includes(contentType.attributes[key]?.type)
      );

      if (searchFields.length > 0) {
        filters.$or = searchFields.map((field) => ({
          [field]: { $contains: search },
        }));
      }
    }

    // Apply Date filters if provided
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

    const [entries, total] = await Promise.all([
      strapi.documents(uid).findMany({
        filters,
        limit: pageSize,
        start: (page - 1) * pageSize,
        status: 'draft',
      }),
      strapi.documents(uid).count({ filters, status: 'draft' }),
    ]);

    return {
      entries,
      total,
      kind: 'collectionType',
      page,
      pageSize,
    };
  },
});
