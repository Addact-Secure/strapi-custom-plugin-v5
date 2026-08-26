import { Upload } from '@strapi/icons';
import pluginId from './pluginId';
import HomePage from './pages/HomePage';

export default {
  register(app) {
    app.addMenuLink({
      to: `plugins/${pluginId}`,
      icon: Upload,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: 'Import / Export',
      },
      Component: async () => HomePage,
      permissions: [],
    });

    app.registerPlugin({
      id: pluginId,
      name: pluginId,
    });
  },
};
