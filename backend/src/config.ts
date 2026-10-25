import fs from 'fs';
import path from 'path';
import type { DeploymentConfig, DataConfig, ApiKeys } from './types';
import { upnpOptionsOf, type UpnpOptions } from './services/upnp/options';

class ConfigManager {
  deploymentConfig: DeploymentConfig | null;
  dataConfig: DataConfig | null;
  dataPath: string | null;

  constructor() {
    this.deploymentConfig = null;
    this.dataConfig = null;
    this.dataPath = null;
  }

  // Load deployment configuration
  loadDeploymentConfig(deploymentFile: string | null = null): DeploymentConfig {
    try {
      let configPath: string;

      if (deploymentFile) {
        // Use provided deployment file
        configPath = path.resolve(deploymentFile);
      } else {
        // Look for deployment.json in current working directory
        const defaultPath = path.join(process.cwd(), 'deployment.json');
        if (fs.existsSync(defaultPath)) {
          configPath = defaultPath;
        } else {
          throw new Error('No deployment file provided and deployment.json not found in working directory');
        }
      }

      if (!fs.existsSync(configPath)) {
        throw new Error(`Deployment file not found: ${configPath}`);
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      this.deploymentConfig = JSON.parse(configData) as DeploymentConfig;

      // Set data path from deployment config
      this.dataPath = path.resolve(this.deploymentConfig.data_path);

      console.log(`Loaded deployment config from: ${configPath}`);
      console.log(`Data path set to: ${this.dataPath}`);

      return this.deploymentConfig;
    } catch (error) {
      console.error('Failed to load deployment config:', (error as Error).message);
      throw error;
    }
  }

  // Load data options from data_path
  loadDataConfig(): DataConfig {
    try {
      if (!this.dataPath) {
        throw new Error('Data path not set. Load deployment config first.');
      }

      // Ensure data directory exists
      if (!fs.existsSync(this.dataPath)) {
        fs.mkdirSync(this.dataPath, { recursive: true });
        console.log(`Created data directory: ${this.dataPath}`);
      }

      const optionsPath = path.join(this.dataPath, 'options.json');

      // Auto-create default options.json if it doesn't exist
      if (!fs.existsSync(optionsPath)) {
        const defaults = {
          log_level: 'info',
          omdb_api_key: '',
          tmdb_api_key: '',
          max_upload_mb: 20
        };
        fs.writeFileSync(optionsPath, JSON.stringify(defaults, null, 2));
        console.log(`Created default options.json at: ${optionsPath}`);
      }

      const optionsData = fs.readFileSync(optionsPath, 'utf8');
      this.dataConfig = JSON.parse(optionsData) as DataConfig;

      console.log(`Loaded data options from: ${optionsPath}`);
      console.log(`Options loaded:`, {
        logLevel: this.dataConfig.log_level,
        hasOmdbKey: !!this.dataConfig.omdb_api_key,
        hasTmdbKey: !!this.dataConfig.tmdb_api_key,
        maxUploadMb: this.dataConfig.max_upload_mb
      });

      return this.dataConfig;
    } catch (error) {
      console.error('Failed to load data options:', (error as Error).message);
      throw error;
    }
  }

  // Get deployment configuration
  getDeploymentConfig(): DeploymentConfig {
    if (!this.deploymentConfig) {
      throw new Error('Deployment config not loaded');
    }
    return this.deploymentConfig;
  }

  // Get data options
  getDataConfig(): DataConfig {
    if (!this.dataConfig) {
      throw new Error('Data options not loaded');
    }
    return this.dataConfig;
  }

  // Get data path
  getDataPath(): string {
    if (!this.dataPath) {
      throw new Error('Data path not set');
    }
    return this.dataPath;
  }

  // Get database path
  getDatabasePath(): string {
    return path.join(this.getDataPath(), 'db.sqlite');
  }

  // Get images directory path
  getImagesPath(): string {
    return path.join(this.getDataPath(), 'images');
  }

  // Get ebooks directory path
  getEbooksPath(): string {
    return path.join(this.getDataPath(), 'ebooks');
  }

  // Get API keys
  // Environment variables take precedence over options.json values
  getApiKeys(): ApiKeys {
    const dataConfig = this.getDataConfig();
    return {
      omdb: process.env.OMDB_API_KEY || dataConfig.omdb_api_key,
      tmdb: process.env.TMDB_API_KEY || dataConfig.tmdb_api_key,
      discogs: process.env.DISCOGS_TOKEN || dataConfig.discogs_token,
      doesthedogdie: process.env.DOES_DOG_DIE || dataConfig.doesthedogdie_api_key,
      googleBooks: process.env.GOOGLE_BOOKS_API_KEY || dataConfig.google_books_api_key
    };
  }

  // The appliances to play on (UPnP), and the media listener they reach
  getUpnpOptions(): UpnpOptions {
    return upnpOptionsOf(this.deploymentConfig as unknown as Record<string, unknown>, this.dataConfig as Record<string, unknown> | null);
  }

  // Get log level
  getLogLevel(): string {
    return this.getDataConfig().log_level || 'info';
  }

  // Get max upload size in MB
  getMaxUploadMb(): number {
    return this.getDataConfig().max_upload_mb || 20;
  }

  // Get max upload size in bytes
  getMaxUploadBytes(): number {
    return this.getMaxUploadMb() * 1024 * 1024;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

export = configManager;
