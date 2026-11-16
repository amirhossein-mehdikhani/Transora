import { spawn } from 'node:child_process';
const command = process.platform === 'win32' ? 'node_modules/vite/bin/vite.js' : 'node_modules/vite/bin/vite.js';
const children = [[], ['--config', 'vite.content.config.ts']].map(args => spawn(process.execPath, [command, 'build', '--watch', ...args], { stdio: 'inherit' }));
const stop = () => children.forEach(child => child.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach(child => child.on('exit', code => { stop(); process.exitCode = code || 0; }));
