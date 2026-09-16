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


const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function isMediaObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Boolean(obj.url && (obj.hash || obj.mime || obj.ext || obj.name));
}

function isMediaArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.every((item) => isMediaObject(item));
}

module.exports = ({ strapi }) => ({
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

  async importContent(payload, { matchingKey = 'auto', publicationStateMode = 'preserve', mediaBaseUrl = '' } = {}) {
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

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    const warnings = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const entryIdentifier = entry.Slug || entry.slug || entry.documentId || entry.title || entry.name || `Entry #${i + 1}`;

      try {
        const processedData = await this.processEntryData(entry, schema, entryIdentifier, warnings, mediaBaseUrl);
        let matchedEntry = null;

        if (schema.kind === 'singleType') {
          matchedEntry = await strapi.documents(contentTypeUid).findFirst({ status: 'draft' });
        } else {
          matchedEntry = await this.findMatchedEntry(entry, schema, contentTypeUid, matchingKey);
        }

        // Determine target publication status
        let targetStatus = 'draft';
        if (publicationStateMode === 'publish') {
          targetStatus = 'published';
        } else if (publicationStateMode === 'draft') {
          targetStatus = 'draft';
        } else if (publicationStateMode === 'preserve') {
          targetStatus = entry.publishedAt ? 'published' : 'draft';
        }

        let resultDoc = null;

        if (matchedEntry) {
          resultDoc = await strapi.documents(contentTypeUid).update({
            documentId: matchedEntry.documentId,
            data: processedData,
            status: 'draft',
          });
          updated++;
        } else {
          resultDoc = await strapi.documents(contentTypeUid).create({
            data: processedData,
            status: 'draft',
          });
          created++;
        }

        // Handle publication if target status is published
        if (targetStatus === 'published' && resultDoc && resultDoc.documentId) {
          try {
            await strapi.documents(contentTypeUid).publish({
              documentId: resultDoc.documentId,
            });
          } catch (pubErr) {
            warnings.push(
              `Entry '${entryIdentifier}': Saved as draft, but failed to publish automatically: ${pubErr.message}`
            );
          }
        }
      } catch (err) {
        failed++;
        errors.push({
          identifier: entryIdentifier,
          error: err.message || 'Import processing error',
        });
      }
    }

    return {
      success: failed === 0,
      contentType: contentTypeUid,
      kind: schema.kind || 'collectionType',
      total: entries.length,
      created,
      updated,
      skipped,
      failed,
      errors,
      warnings,
    };
  },

  async processEntryData(data, schema, entryIdentifier, warnings, mediaBaseUrl = '') {
    if (!data || typeof data !== 'object') return data;

    const attributes = schema ? schema.attributes || {} : {};
    const result = {};

    // Do NOT pass auto-generated integer DB IDs
    for (const key of Object.keys(data)) {
      if (['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'publishedAt', 'documentId'].includes(key)) {
        continue;
      }

      const val = data[key];
      const attr = attributes[key];

      if (!attr) {
        // Component or custom key without formal attribute
        if (isMediaObject(val) || isMediaArray(val)) {
          result[key] = await this.resolveMedia(val, entryIdentifier, warnings, mediaBaseUrl);
        } else if (typeof val === 'object' && val !== null) {
          result[key] = await this.processEntryData(val, null, entryIdentifier, warnings, mediaBaseUrl);
        } else {
          result[key] = val;
        }
        continue;
      }

      if (attr.type === 'media') {
        result[key] = await this.resolveMedia(val, entryIdentifier, warnings, mediaBaseUrl);
      } else if (attr.type === 'relation') {
        result[key] = await this.resolveRelation(val, attr, entryIdentifier, warnings);
      } else if (attr.type === 'component') {
        const compSchema = strapi.components[attr.component];
        if (Array.isArray(val)) {
          result[key] = [];
          for (const item of val) {
            const processedItem = await this.processEntryData(item, compSchema, entryIdentifier, warnings, mediaBaseUrl);
            result[key].push(processedItem);
          }
        } else if (val && typeof val === 'object') {
          result[key] = await this.processEntryData(val, compSchema, entryIdentifier, warnings, mediaBaseUrl);
        } else {
          result[key] = null;
        }
      } else if (attr.type === 'dynamiczone') {
        if (Array.isArray(val)) {
          result[key] = [];
          for (const dzItem of val) {
            if (dzItem && dzItem.__component) {
              const compSchema = strapi.components[dzItem.__component];
              const processedDzItem = await this.processEntryData(dzItem, compSchema, entryIdentifier, warnings, mediaBaseUrl);
              processedDzItem.__component = dzItem.__component;
              result[key].push(processedDzItem);
            }
          }
        } else {
          result[key] = [];
        }
      } else {
        result[key] = val;
      }
    }

    return result;
  },

  async resolveMedia(val, entryIdentifier, warnings, mediaBaseUrl = '') {
    if (!val) return null;
    const items = Array.isArray(val) ? val : [val];
    const resolvedIds = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      // 1. Search existing media in target Upload Library by hash / url / name
      const orFilters = [];
      if (item.hash) orFilters.push({ hash: item.hash });
      if (item.name) orFilters.push({ name: item.name });
      if (item.url) orFilters.push({ url: item.url });

      if (orFilters.length > 0) {
        const existingFiles = await strapi.documents('plugin::upload.file').findMany({
          filters: { $or: orFilters },
          limit: 1,
        });

        if (existingFiles && existingFiles.length > 0) {
          const mediaId = existingFiles[0].id || existingFiles[0].documentId;
          console.log(`[Import Plugin] Matched existing media file in target DB: id=${mediaId}`, existingFiles[0]);
          resolvedIds.push(mediaId);
          continue;
        }
      }

      // 2. Determine target media download URL
      let targetUrl = item.url || '';
      if (targetUrl && targetUrl.startsWith('/')) {
        const base = mediaBaseUrl || strapi.config.get('server.url') || process.env.PUBLIC_URL || '';
        if (base && (base.startsWith('http://') || base.startsWith('https://'))) {
          const cleanBase = base.replace(/\/+$/, '');
          targetUrl = `${cleanBase}${targetUrl}`;
        }
      }

      // 3. Register or Download Media if remote URL present (http / https) or relative
      if (targetUrl) {
        // Step A: Register Azure / CDN media file directly in target DB plugin::upload.file table
        try {
          const registeredFile = await strapi.db.query('plugin::upload.file').create({
            data: {
              name: item.name || path.basename((targetUrl || 'file.png').split('?')[0]) || 'file.png',
              hash: item.hash || path.basename((targetUrl || 'file.png').split('?')[0]),
              ext: item.ext || path.extname((targetUrl || 'file.png').split('?')[0]) || '.png',
              mime: item.mime || 'image/png',
              size: item.size || 0,
              url: targetUrl || item.url || '',
              caption: item.caption || '',
              alternativeText: item.alternativeText || '',
              provider: item.provider || 'azure',
            },
          });

          console.log('[Import Plugin] Direct DB registration result:', registeredFile);

          if (registeredFile) {
            const finalId = registeredFile.id || registeredFile.documentId;
            resolvedIds.push(finalId);
            continue;
          }
        } catch (regErr) {
          console.error('[Import Plugin] Direct DB registration failed:', regErr.message);
        }

        // Step B: Download & Upload Media if direct DB registration was not used
        if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
          try {
            const uploadedFile = await this.downloadAndUploadMedia(item, targetUrl);
            if (uploadedFile) {
              resolvedIds.push(uploadedFile.documentId || uploadedFile.id);
              continue;
            }
          } catch (downloadErr) {
            warnings.push(
              `Entry '${entryIdentifier}': Could not download media asset '${item.name || targetUrl}': ${downloadErr.message}`
            );
          }
        }
      } else {
        warnings.push(
          `Entry '${entryIdentifier}': Media asset '${item.name || item.hash || item.url}' not found in target environment and no valid media host URL provided.`
        );
      }
    }

    return Array.isArray(val) ? resolvedIds : resolvedIds[0] || null;
  },

  async downloadAndUploadMedia(mediaInfo, targetUrl) {
    const downloadUrl = targetUrl || mediaInfo.url;
    return new Promise((resolve, reject) => {
      const client = downloadUrl.startsWith('https://') ? https : http;
      const os = require('os');
      client
        .get(downloadUrl, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP status ${res.statusCode} downloading ${downloadUrl}`));
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', async () => {
            let tmpPath = null;
            try {
              const buffer = Buffer.concat(chunks);
              const fileName = mediaInfo.name || path.basename(downloadUrl.split('?')[0]) || 'file.png';
              const fileMime = mediaInfo.mime || 'image/png';
              const tmpDir = os.tmpdir();
              tmpPath = path.join(tmpDir, `strapi_import_${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`);

              fs.writeFileSync(tmpPath, buffer);

              const uploadService = strapi.plugin('upload').service('upload');
              const fileObj = {
                path: tmpPath,
                filepath: tmpPath,
                tmpPath: tmpPath,
                name: fileName,
                originalFilename: fileName,
                type: fileMime,
                mimetype: fileMime,
                size: buffer.length,
                buffer: buffer,
              };

              const uploadedFiles = await uploadService.upload({
                data: {
                  fileInfo: {
                    name: fileName,
                    caption: mediaInfo.caption || '',
                    alternativeText: mediaInfo.alternativeText || '',
                  },
                },
                files: fileObj,
              });

              if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch (e) {}
              }

              const uploaded = Array.isArray(uploadedFiles) ? uploadedFiles[0] : uploadedFiles;
              resolve(uploaded);
            } catch (err) {
              if (tmpPath && fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch (e) {}
              }
              reject(err);
            }
          });
        })
        .on('error', (err) => reject(err));
    });
  },

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

  async resolveRelation(val, attr, entryIdentifier, warnings) {
    if (!val) return null;
    const targetUid = attr.target;
    if (!targetUid || !strapi.contentTypes[targetUid]) {
      warnings.push(`Entry '${entryIdentifier}': Relation target content type '${targetUid}' does not exist.`);
      return null;
    }

    const items = Array.isArray(val) ? val : [val];
    const resolvedDocumentIds = [];

    for (const item of items) {
      const targetSchema = strapi.contentTypes[targetUid];
      const result = await this.resolveRelationItem(item, targetUid, targetSchema, entryIdentifier, warnings);
      if (result && result.id) {
        resolvedDocumentIds.push(result.id);
      }
    }

    return Array.isArray(val) ? resolvedDocumentIds : resolvedDocumentIds[0] || null;
  },
});
