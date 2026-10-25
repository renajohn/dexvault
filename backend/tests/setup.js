// Set test environment
process.env.NODE_ENV = 'test';

// The developer's shell may export the real key; tests must never reach the API.
delete process.env.DOES_DOG_DIE;
// Nor filmages.ch: a movie created in a test would be looked up there.
process.env.FILMAGES_OFFLINE = '1';
delete process.env.DROPBOX_APP_KEY;
delete process.env.DROPBOX_APP_SECRET;
delete process.env.DROPBOX_REFRESH_TOKEN;

jest.mock('../src/config', () => ({
  loadDeploymentConfig: () => ({}),
  loadDataConfig: () => ({}),
  getDeploymentConfig: () => ({}),
  getDataConfig: () => ({}),
  getDatabasePath: () => ':memory:',
  getDataPath: () => '/tmp/dexvault-test',
  getImagesPath: () => '/tmp/dexvault-test/images',
  getEbooksPath: () => '/tmp/dexvault-test/ebooks',
  getApiKeys: () => ({ omdb: '', tmdb: '', discogs: 'test-token', doesthedogdie: '' }),
  getLogLevel: () => 'error',
  getMaxUploadMb: () => 20,
  getMaxUploadBytes: () => 20 * 1024 * 1024,
  // No appliance, no media listener: a test that needs them builds its own.
  getUpnpOptions: () => jest.requireActual('../src/services/upnp/options').upnpOptionsOf({}, {}, {}),
}));

// Wait for app initialization (database tables, migrations, etc.)
beforeAll(async () => {
  // index.ts is an ES module compiled to CJS, so the app lives under `.default`.
  const mod = require('../index');
  const app = mod.default || mod;
  if (app.serverReady) {
    await app.serverReady;
  }
});
