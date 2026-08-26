# Strapi 5 Universal Import/Export Plugin

A lightweight, high-performance, and completely schema-driven plugin for exporting and importing Content Types, Single Types, components, Dynamic Zones, relations, and media in **Strapi 5**.

---

## Features

- **Schema-Driven Architecture:** No hardcoded content type names, relationship fields, or dynamic structure layouts.
- **Dynamic Entry & Relation Matching Engine:**
  1. **Step 1:** Automatically checks for schema-defined unique fields (`unique: true` or `type: "uid"`).
  2. **Step 2:** Performs exact `documentId` matching (crucial for same-database restorations or Local → Local syncs).
  3. **Step 3:** Performs a dynamic composite scalar-field fingerprint lookup if the document ID is not found (safely handles UAT/Prod cross-environment imports without data corruption).
- **Clean Two-Column Admin Dashboard:** Minimalist visual separation between Import and Export cards, built using `@strapi/design-system`.
- **Zero Third-Party Node Server Dependencies:** Relies entirely on built-in Node modules for zero bundle size impact.
- **Dynamic Entries Display Selector:** Content editors can dynamically pick which schema field to display in selection lists.

---

## Installation

You can install this plugin into any Strapi 5 project either as a local plugin or via a tarball.

### Option A: Local Plugin Setup (Recommended for Customizations)

1. Copy the `import-export` directory into your target Strapi project's `src/plugins/import-export` folder.
2. Register the plugin in your target project's `config/plugins.js` file:

```javascript
module.exports = {
  'import-export': {
    enabled: true,
    resolve: './src/plugins/import-export'
  },
};
```

3. Enable the plugin in your backend server and build the admin panel:
```bash
npm run build
npm run develop
```

### Option B: Local File Dependency Setup

If you prefer installing it without committing the source code inside your main repository:

1. Package the plugin directory:
```bash
cd path/to/import-export
npm pack
```
This generates a file like `strapi-navnath-plugin-import-export-v5-1.0.0.tgz`.

2. Install the package in your target Strapi 5 project:
```bash
npm install /path/to/strapi-navnath-plugin-import-export-v5-1.0.0.tgz
```

3. Register it in `config/plugins.js`:
```javascript
module.exports = {
  'import-export': {
    enabled: true,
  },
};
```

4. Build and run:
```bash
npm run build
npm run develop
```

---

## How It Works

The plugin dynamically interfaces with Strapi 5 schema structures at runtime:
1. **Model Discovery:** Reads `strapi.contentTypes` and filters for user-created models (`api::`).
2. **Dynamic Populating:** During exports, it builds recursive populate schemas depending entirely on the content model relations and component configuration.
3. **Data Import/Update:** Processes payload items. If matching entries exist, it updates them using Strapi 5 Document Service upsert strategies. Otherwise, it creates fresh records.

---

## License

MIT License. Feel free to customize and redistribute!
