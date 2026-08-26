/**
 * Splits an array into smaller chunks of a specified size.
 *
 * @param {Array} array - The array to chunk.
 * @param {number} size - The maximum size of each chunk.
 * @returns {Array[]} An array of smaller arrays.
 */
export const chunkArray = (array, size) => {
  if (!array || !array.length) return [];
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Aggregates multiple import response results into a single summary object.
 *
 * @param {Array} results - Array of response data objects from the backend.
 * @returns {Object} A single aggregated result object.
 */
export const aggregateImportResults = (results) => {
  if (!results || !results.length) return null;

  return results.reduce(
    (acc, curr) => {
      // The first chunk dictates the base metadata (contentType, kind)
      if (!acc.contentType && curr.contentType) {
        acc.contentType = curr.contentType;
        acc.kind = curr.kind;
        acc.success = curr.success; // Will be re-evaluated below
      }

      acc.total += curr.total || 0;
      acc.created += curr.created || 0;
      acc.updated += curr.updated || 0;
      acc.skipped += curr.skipped || 0;
      acc.failed += curr.failed || 0;
      acc.errors = acc.errors.concat(curr.errors || []);
      acc.warnings = acc.warnings.concat(curr.warnings || []);

      // If any chunk fails, overall success is false, or if there are any failures
      if (!curr.success || curr.failed > 0) {
        acc.success = false;
      }

      return acc;
    },
    {
      success: true,
      contentType: '',
      kind: '',
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      warnings: [],
    }
  );
};
