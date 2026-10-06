#!/usr/bin/env node
// Needs: npm install --no-save --no-package-lock ajv ajv-formats   (run at repo root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_BASE = 'https://raw.githubusercontent.com/cursor/plugins/main/schemas';

const { default: Ajv } = await import('ajv');
const { default: addFormats } = await import('ajv-formats');

const fetchSchema = async (name) => {
  const res = await fetch(`${SCHEMA_BASE}/${name}`);
  if (!res.ok) throw new Error(`fetch ${name}: HTTP ${res.status}`);
  return res.json();
};
const [marketplaceSchema, pluginSchema] = await Promise.all([
  fetchSchema('marketplace.schema.json'),
  fetchSchema('plugin.schema.json'),
]);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateMarketplace = ajv.compile(marketplaceSchema);
const validatePlugin = ajv.compile(pluginSchema);

const errors = [];
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const report = (label, validate) => {
  for (const e of validate.errors ?? []) errors.push(`${label}: ${e.instancePath || '/'} ${e.message}`);
};

const marketplacePath = path.join(repoDir, '.cursor-plugin/marketplace.json');
const marketplace = readJson(marketplacePath);
if (!validateMarketplace(marketplace)) report('marketplace.json', validateMarketplace);

for (const entry of marketplace.plugins ?? []) {
  const dir = path.join(repoDir, entry.source);
  if (!fs.existsSync(dir)) {
    errors.push(`${entry.name}: source dir missing: ${entry.source}`);
    continue;
  }
  const pluginPath = path.join(dir, '.cursor-plugin/plugin.json');
  if (!fs.existsSync(pluginPath)) {
    errors.push(`${entry.name}: missing ${entry.source}/.cursor-plugin/plugin.json`);
    continue;
  }
  const plugin = readJson(pluginPath);
  if (!validatePlugin(plugin)) report(`${entry.name}/plugin.json`, validatePlugin);
  if (plugin.name !== entry.name) errors.push(`${entry.name}: plugin.json name "${plugin.name}" differs from marketplace entry`);
  if (plugin.logo && !fs.existsSync(path.join(dir, plugin.logo))) errors.push(`${entry.name}: logo not found: ${plugin.logo}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`validated ${marketplace.plugins.length} plugin(s)`);
