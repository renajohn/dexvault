#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

class BuildSystem {
  constructor() {
    this.projectRoot = __dirname;
    this.distDir = path.join(this.projectRoot, 'dist');
    this.deploymentTarget = process.argv[2] || 'dev';
    this.version = this.generateVersion();
    
    console.log(`🚀 Building DexVault for target: ${this.deploymentTarget}`);
    console.log(`📦 Version: ${this.version}`);
  }

  generateVersion() {
    try {
      // Get package.json version
      const packageJson = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf8'));
      const baseVersion = packageJson.version;
      
      // Get short git hash
      const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      
      return `${baseVersion}-${gitHash}`;
    } catch (error) {
      console.warn('⚠️  Could not generate version from git, using timestamp');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      return `0.0.1-${timestamp}`;
    }
  }

  cleanDist() {
    console.log('🧹 Cleaning dist directory...');
    if (fs.existsSync(this.distDir)) {
      fs.rmSync(this.distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(this.distDir, { recursive: true });
  }

  buildFrontend() {
    console.log('🎨 Building frontend...');
    
    const env = {
      ...process.env,
      NODE_ENV: this.deploymentTarget === 'prod' ? 'production' : 'development',
      GENERATE_SOURCEMAP: this.deploymentTarget === 'dev' ? 'true' : 'false',
      PUBLIC_URL: '/'
    };

    execSync('npm run build', {
      cwd: path.join(this.projectRoot, 'frontend'),
      env,
      stdio: 'inherit'
    });

    // Copy frontend build to dist
    const frontendBuildDir = path.join(this.projectRoot, 'frontend', 'build');
    const distFrontendDir = path.join(this.distDir, 'frontend');
    this.copyDirectory(frontendBuildDir, distFrontendDir);

    console.log('✅ Frontend built successfully');
  }

  buildBackend() {
    console.log('⚙️  Building backend...');
    
    // Copy backend files to dist
    const backendDir = path.join(this.distDir, 'backend');
    fs.mkdirSync(backendDir, { recursive: true });
    
    // Copy backend files (excluding node_modules - let Docker install fresh)
    const backendFiles = [
      'index.ts',
      'tsconfig.json',
      'package.json',
      'package-lock.json'
    ];
    
    const backendDirs = [
      'src',
      'migrations'
      // Removed 'node_modules' - Docker will install fresh dependencies
    ];
    
    // Copy individual files
    backendFiles.forEach(file => {
      const srcPath = path.join(this.projectRoot, 'backend', file);
      const destPath = path.join(backendDir, file);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    });
    
    // Copy directories (excluding node_modules)
    backendDirs.forEach(dir => {
      const srcPath = path.join(this.projectRoot, 'backend', dir);
      const destPath = path.join(backendDir, dir);
      if (fs.existsSync(srcPath)) {
        this.copyDirectoryExcluding(srcPath, destPath, ['node_modules']);
      }
    });
    
    console.log('✅ Backend built successfully');
  }

  // Data directory will be mounted as volume in Docker, no need to copy

  copyDeploymentConfig() {
    console.log('📋 Copying deployment configuration...');
    
    const deploymentFile = `deployment.${this.deploymentTarget}.json`;
    const srcPath = path.join(this.projectRoot, deploymentFile);
    const destPath = path.join(this.distDir, 'deployment.json');
    
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Deployment file not found: ${deploymentFile}`);
    }
    
    fs.copyFileSync(srcPath, destPath);
    console.log(`✅ Copied ${deploymentFile} to deployment.json`);
  }

  createDataSymlink() {
    console.log('🔗 Creating data directory symlink for local testing...');
    
    const dataSrcPath = path.join(this.projectRoot, 'data');
    const dataDestPath = path.join(this.distDir, 'data');
    
    // Only create symlink if source data directory exists and we're not in Docker
    if (fs.existsSync(dataSrcPath) && !process.env.DOCKER_BUILD) {
      try {
        // Remove existing symlink or directory if it exists
        if (fs.existsSync(dataDestPath)) {
          fs.rmSync(dataDestPath, { recursive: true, force: true });
        }
        
        // Create symlink
        fs.symlinkSync(dataSrcPath, dataDestPath, 'dir');
        console.log('✅ Data directory symlink created for local testing');
        console.log('   Note: This symlink is for local testing only and will not be included in Docker builds');
      } catch (error) {
        console.warn('⚠️  Could not create data symlink:', error.message);
        console.log('   Continuing without symlink...');
      }
    } else {
      console.log('ℹ️  Skipping data symlink (Docker build or no data directory)');
    }
  }

  createStartScript() {
    console.log('📝 Creating start script...');
    
    const startScript = `#!/bin/bash
# DexVault Start Script
# Version: ${this.version}
# Target: ${this.deploymentTarget}

echo "🚀 Starting DexVault ${this.version} (${this.deploymentTarget})"

# Change to backend directory
cd backend

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the application with deployment config from parent directory
echo "🎬 Starting DexVault backend..."
npx tsx index.ts --deployment=../deployment.json

echo "👋 DexVault stopped"
`;

    const scriptPath = path.join(this.distDir, 'start.sh');
    fs.writeFileSync(scriptPath, startScript);
    fs.chmodSync(scriptPath, '755');
    
    console.log('✅ Start script created');
  }

  checkSecurity() {
    console.log('🔒 Checking for security issues...');
    
    // Check for .env files in the dist directory
    const envFiles = [];
    const checkDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          checkDir(fullPath);
        } else if (item.name.startsWith('.env')) {
          envFiles.push(fullPath);
        }
      }
    };
    
    checkDir(this.distDir);
    
    if (envFiles.length > 0) {
      console.warn('⚠️  WARNING: .env files detected in dist directory:');
      envFiles.forEach(file => console.warn(`   ${file}`));
      console.warn('   These files will be included in Docker images!');
      console.warn('   Make sure .dockerignore is working correctly.');
    } else {
      console.log('✅ No .env files found in dist directory');
    }
    
    // Check if .dockerignore exists and contains .env
    const dockerignorePath = path.join(this.projectRoot, '.dockerignore');
    if (fs.existsSync(dockerignorePath)) {
      const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf8');
      if (dockerignoreContent.includes('.env')) {
        console.log('✅ .dockerignore properly excludes .env files');
      } else {
        console.warn('⚠️  WARNING: .dockerignore may not exclude .env files');
      }
    }
  }

  copyDirectory(src, dest) {
    if (!fs.existsSync(src)) return;
    
    fs.mkdirSync(dest, { recursive: true });
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDirectoryExcluding(src, dest, excludeDirs = []) {
    if (!fs.existsSync(src)) return;
    
    fs.mkdirSync(dest, { recursive: true });
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip excluded directories
      if (entry.isDirectory() && excludeDirs.includes(entry.name)) {
        continue;
      }
      
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this.copyDirectoryExcluding(srcPath, destPath, excludeDirs);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  createVersionFile() {
    console.log('📄 Creating version file...');
    
    const versionInfo = {
      version: this.version,
      target: this.deploymentTarget,
      buildTime: new Date().toISOString(),
      gitHash: this.getGitHash(),
      nodeVersion: process.version
    };
    
    const versionPath = path.join(this.distDir, 'version.json');
    fs.writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2));
    
    console.log('✅ Version file created');
  }

  getGitHash() {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
      return 'unknown';
    }
  }

  async build() {
    try {
      this.cleanDist();
      this.buildFrontend();
      this.buildBackend();
      this.copyDeploymentConfig();
      this.createDataSymlink();
      this.createStartScript();
      this.createVersionFile();
      this.checkSecurity();
      
      console.log('\n🎉 Build completed successfully!');
      console.log(`📁 Output directory: ${this.distDir}`);
      console.log(`🏷️  Version: ${this.version}`);
      console.log(`🎯 Target: ${this.deploymentTarget}`);
      console.log('\n🚀 To start the application:');
      console.log(`   cd ${this.distDir}`);
      console.log('   ./start.sh');
      
    } catch (error) {
      console.error('❌ Build failed:', error.message);
      process.exit(1);
    }
  }
}

// Run the build
const buildSystem = new BuildSystem();
buildSystem.build();