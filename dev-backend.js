#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// Load environment variables from .env file
require('dotenv').config();

console.log('🔄 Starting backend development mode with nodemon...');
console.log('📝 Nodemon will automatically restart on file changes');

const backendProcess = spawn('npm run dev', {
  stdio: 'inherit',
  shell: true,
  cwd: path.join(__dirname, 'backend'),
  env: { ...process.env }
});

backendProcess.on('error', (err) => {
  console.error('❌ Error starting backend:', err);
  process.exit(1);
});

// Pass through exit signals
process.on('SIGINT', () => {
  backendProcess.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  backendProcess.kill('SIGTERM');
  process.exit(0);
});
