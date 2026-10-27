import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

const { buildIntegrationReadiness } = await import('../server/services/integrationReadiness.js');
const report = await buildIntegrationReadiness({ probe: process.argv.includes('--probe') });

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const icons = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', external: 'EXTERNAL' };
  console.log(`\nFaceless Studio integration readiness — ${report.generatedAt}`);
  console.log(`Environment: ${report.environment}`);
  console.log(`Overall: ${report.overall.toUpperCase()}  (${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.external} external)\n`);
  for (const item of report.checks) {
    console.log(`[${icons[item.status] || item.status.toUpperCase()}] ${item.title}`);
    if (typeof item.detail === 'string') console.log(`  ${item.detail}`);
    else if (item.detail && typeof item.detail === 'object') {
      for (const [key, value] of Object.entries(item.detail)) if (typeof value === 'string') console.log(`  ${key}: ${value}`);
    }
    if (item.action) console.log(`  Action: ${item.action}`);
  }
  console.log('\nCallback URLs:');
  for (const [key, value] of Object.entries(report.callbacks)) console.log(`  ${key.padEnd(18)} ${value}`);
  console.log('\nProvider approval checklist:');
  for (const item of report.providerApproval) {
    console.log(`  - ${item.platform} (${item.loginType})`);
    console.log(`    ${item.appReview}`);
    for (const url of item.docs || []) console.log(`    ${url}`);
  }
  if (report.productionWarnings.length) {
    console.log('\nProduction warnings:');
    for (const warning of report.productionWarnings) console.log(`  - ${warning}`);
  }
  console.log(`\n${report.note}\n`);
}

if (report.overall === 'blocked') process.exitCode = 1;
