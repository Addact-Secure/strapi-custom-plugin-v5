'use strict';

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

function getUniqueKeysForSchema(schema) {
  if (!schema) return [];
  const attributes = schema.attributes || {};
  const uniqueKeys = [];

  Object.keys(attributes).forEach((attrName) => {
    const attr = attributes[attrName];
    const isUnique = attr && (attr.unique === true || attr.type === 'uid');
    const isScalar = isComparableScalarField(attrName, attr);

    if (isScalar && isUnique) {
      if (!uniqueKeys.includes(attrName)) {
        uniqueKeys.push(attrName);
      }
    }
  });

  return uniqueKeys;
}


module.exports = ({ strapi }) => ({
  async resolveRelationItem(item, targetUid, targetSchema, entryIdentifier, warnings) {
    if (!item || typeof item !== 'object') return null;

    const targetAttrs = targetSchema ? targetSchema.attributes || {} : {};

    // 1. Check unique keys
    const uniqueKeys = getUniqueKeysForSchema(targetSchema);
    const availableUniqueKeys = uniqueKeys.filter((k) => item[k] !== undefined && item[k] !== null);

    if (availableUniqueKeys.length > 0) {
      // SCENARIO 1: Unique identifier is available
      for (const key of availableUniqueKeys) {
        const matchVal = item[key];
        const found = await strapi.documents(targetUid).findMany({
          filters: { [key]: matchVal },
          status: 'draft',
          limit: 1,
        });
        if (found && found.length > 0) {
          return { id: found[0].documentId, status: 'resolved' };
        }
      }

      // Fallback to matching by documentId if schema unique keys exist but none matched
      if (item.documentId) {
        const found = await strapi.documents(targetUid).findMany({
          filters: { documentId: item.documentId },
          status: 'draft',
          limit: 1,
        });
        if (found && found.length > 0) {
          return { id: found[0].documentId, status: 'resolved' };
        }
      }

      warnings.push(
        `Entry '${entryIdentifier}': Related target '${targetUid}' (matched by unique keys: ${availableUniqueKeys.join(', ')}) was not found in target DB.`
      );
      return { id: null, status: 'unresolved' };
    }

    // 2. Step 2: Exact documentId matching (Same-environment / same-DB fallback)
    if (item.documentId) {
      const found = await strapi.documents(targetUid).findMany({
        filters: { documentId: item.documentId },
        status: 'draft',
        limit: 1,
      });
      if (found && found.length > 0) {
        return { id: found[0].documentId, status: 'resolved' };
      }
    }

    // 3. Step 3: No schema-defined unique keys & documentId not found in target. Try dynamic scalar-field fingerprint matching
    const scalarFields = [];
    Object.keys(targetAttrs).forEach((key) => {
      const field = targetAttrs[key];
      if (isComparableScalarField(key, field)) {
        scalarFields.push(key);
      }
    });

    const availableScalarKeys = scalarFields.filter((k) => item[k] !== undefined && item[k] !== null);

    if (availableScalarKeys.length > 0) {
      const filters = {};
      availableScalarKeys.forEach((key) => {
        filters[key] = item[key];
      });

      const found = await strapi.documents(targetUid).findMany({
        filters,
        status: 'draft',
        limit: 2,
      });

      if (found && found.length === 1) {
        return { id: found[0].documentId, status: 'resolved' };
      } else if (found && found.length > 1) {
        warnings.push(
          `Entry '${entryIdentifier}': Related target '${targetUid}' (matched by fields: ${availableScalarKeys.join(', ')}) returned multiple matching entries (Ambiguous Match).`
        );
        return { id: null, status: 'ambiguous' };
      }
    }

    warnings.push(
      `Entry '${entryIdentifier}': Related target '${targetUid}' (matched by fields: ${availableScalarKeys.join(', ') || 'none'}) was not found in target DB.`
    );
    return { id: null, status: 'unresolved' };
  },

  async findMatchedEntry(entry, schema, contentTypeUid, matchingKey) {
    if (!entry) return null;

    const targetAttrs = schema.attributes || {};

    // 1. Explicit matching key requested
    if (matchingKey && matchingKey !== 'auto') {
      const matchVal = entry[matchingKey];
      if (matchVal !== undefined && matchVal !== null) {
        const found = await strapi.documents(contentTypeUid).findMany({
          filters: { [matchingKey]: matchVal },
          status: 'draft',
          limit: 2,
        });
        if (found && found.length === 1) {
          return found[0];
        } else if (found && found.length > 1) {
          throw new Error(`Ambiguous match: Multiple entries found matching ${matchingKey}='${matchVal}'`);
        }
      }
      return null;
    }

    // 2. Auto-matching logic
    // Step A: Try Schema-confirmed unique keys
    const uniqueKeys = getUniqueKeysForSchema(schema);
    const availableUniqueKeys = uniqueKeys.filter((k) => entry[k] !== undefined && entry[k] !== null);
    if (availableUniqueKeys.length > 0) {
      for (const key of availableUniqueKeys) {
        const matchVal = entry[key];
        const found = await strapi.documents(contentTypeUid).findMany({
          filters: { [key]: matchVal },
          status: 'draft',
          limit: 1,
        });
        if (found && found.length > 0) {
          return found[0];
        }
      }
      
      // Fallback to documentId matching if schema unique keys exist but none matched
      if (entry.documentId) {
        const found = await strapi.documents(contentTypeUid).findMany({
          filters: { documentId: entry.documentId },
          status: 'draft',
          limit: 1,
        });
        if (found && found.length > 0) {
          return found[0];
        }
      }
      return null; // Unique key specified in schema, but not found in target
    }

    // Step B: Exact documentId matching (Same-environment / same-DB fallback)
    if (entry.documentId) {
      const found = await strapi.documents(contentTypeUid).findMany({
        filters: { documentId: entry.documentId },
        status: 'draft',
        limit: 1,
      });
      if (found && found.length > 0) {
        return found[0];
      }
    }

    // Step C: No stable schema-defined unique keys & documentId not found in target. Try dynamic scalar-field fingerprint matching
    const scalarFields = [];
    Object.keys(targetAttrs).forEach((key) => {
      const field = targetAttrs[key];
      if (isComparableScalarField(key, field)) {
        scalarFields.push(key);
      }
    });

    const availableScalarKeys = scalarFields.filter((k) => entry[k] !== undefined && entry[k] !== null);
    if (availableScalarKeys.length > 0) {
      const filters = {};
      availableScalarKeys.forEach((key) => {
        filters[key] = entry[key];
      });

      const found = await strapi.documents(contentTypeUid).findMany({
        filters,
        status: 'draft',
        limit: 2,
      });

      if (found && found.length === 1) {
        return found[0];
      } else if (found && found.length > 1) {
        throw new Error(`Ambiguous match: Multiple entries found matching scalar fields: ${availableScalarKeys.join(', ')}`);
      }
    }

    return null;
  },

  async previewImport(payload, { matchingKey = 'auto', publicationStateMode = 'preserve' } = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid JSON payload provided.');
    }

    const contentTypeUid = payload.contentType;
    if (!contentTypeUid || !strapi.contentTypes[contentTypeUid]) {
      throw new Error(`Content type '${contentTypeUid}' is not registered in target Strapi environment.`);
    }

    const schema = strapi.contentTypes[contentTypeUid];
    const rawData = payload.data;
    const entries = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];

    let createCount = 0;
    let updateCount = 0;
    let missingRelationsCount = 0;
    let missingMediaCount = 0;
    const details = [];
    const warnings = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      let matchedEntry = null;
      let matchedByStrategy = matchingKey;
      let ambiguityError = null;

      try {
        if (schema.kind === 'singleType') {
          matchedEntry = await strapi.documents(contentTypeUid).findFirst({ status: 'draft' });
          matchedByStrategy = 'singleType';
        } else {
          matchedEntry = await this.findMatchedEntry(entry, schema, contentTypeUid, matchingKey);
          matchedByStrategy = matchingKey === 'auto' ? 'auto' : matchingKey;
        }
      } catch (err) {
        ambiguityError = err.message;
      }

      const entryIdentifier = entry.Slug || entry.slug || entry.documentId || entry.title || entry.name || `Entry #${i + 1}`;

      if (ambiguityError) {
        warnings.push(`Entry '${entryIdentifier}': ${ambiguityError}`);
        details.push({
          identifier: entryIdentifier,
          action: 'error',
          matchedBy: 'ambiguous',
          error: ambiguityError,
        });
      } else if (matchedEntry) {
        updateCount++;
        details.push({
          identifier: entryIdentifier,
          action: 'update',
          matchedBy: matchedByStrategy,
          targetDocumentId: matchedEntry.documentId,
        });
      } else {
        createCount++;
        details.push({
          identifier: entryIdentifier,
          action: 'create',
          matchedBy: 'new',
        });
      }

      // Check relation & media completeness for this entry
      await this.checkDependencies(entry, schema, entryIdentifier, warnings, {
        onMissingRelation: () => missingRelationsCount++,
        onMissingMedia: () => missingMediaCount++,
      });
    }

    return {
      version: payload.version || '1.0',
      contentType: contentTypeUid,
      kind: schema.kind || 'collectionType',
      matchingKeyUsed: effectiveMatchingKey,
      publicationStateMode,
      summary: {
        total: entries.length,
        create: createCount,
        update: updateCount,
        missingRelations: missingRelationsCount,
        missingMedia: missingMediaCount,
        warningsCount: warnings.length,
      },
      details,
      warnings,
    };
  },

  async checkDependencies(data, schema, entryIdentifier, warnings, counters) {
    if (!data || typeof data !== 'object') return;
    const attributes = schema ? schema.attributes || {} : {};

    for (const key of Object.keys(data)) {
      const val = data[key];
      const attr = attributes[key];

      if (!attr || !val) continue;

      if (attr.type === 'relation') {
        const targetUid = attr.target;
        const targetSchema = targetUid ? strapi.contentTypes[targetUid] : null;
        const rels = Array.isArray(val) ? val : [val];

        for (const rel of rels) {
          const result = await this.resolveRelationItem(rel, targetUid, targetSchema, entryIdentifier, warnings);
          if (!result || result.status !== 'resolved') {
            counters.onMissingRelation();
          }
        }
      } else if (attr.type === 'media') {
        const mediaItems = Array.isArray(val) ? val : [val];
        for (const media of mediaItems) {
          if (!media || typeof media !== 'object') continue;
          if (media.hash || media.url) {
            const filters = {};
            if (media.hash) filters.hash = media.hash;
            else if (media.url) filters.url = media.url;

            const existingFile = await strapi.documents('plugin::upload.file').findMany({
              filters,
              limit: 1,
            });

            if (!existingFile || existingFile.length === 0) {
              if (media.url && (media.url.startsWith('http://') || media.url.startsWith('https://'))) {
                // Will attempt auto-download during import
              } else {
                counters.onMissingMedia();
                warnings.push(
                  `Entry '${entryIdentifier}': Media file '${media.name || media.hash}' not found locally in target library.`
                );
              }
            }
          }
        }
      } else if (attr.type === 'component') {
        const compSchema = strapi.components[attr.component];
        if (Array.isArray(val)) {
          for (const item of val) {
            await this.checkDependencies(item, compSchema, entryIdentifier, warnings, counters);
          }
        } else if (typeof val === 'object') {
          await this.checkDependencies(val, compSchema, entryIdentifier, warnings, counters);
        }
      } else if (attr.type === 'dynamiczone' && Array.isArray(val)) {
        for (const dzItem of val) {
          if (dzItem && dzItem.__component) {
            const compSchema = strapi.components[dzItem.__component];
            await this.checkDependencies(dzItem, compSchema, entryIdentifier, warnings, counters);
          }
        }
      }
    }
  },
});
