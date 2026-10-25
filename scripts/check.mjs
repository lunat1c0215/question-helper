import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

const manifestPath = join(root, 'manifest.json');
check(existsSync(manifestPath), 'manifest.json is missing');

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  check(manifest.manifest_version === 3, 'manifest_version must be 3');
  check(!('content_scripts' in manifest), 'static content_scripts must stay absent');
  check(!('web_accessible_resources' in manifest), 'web_accessible_resources must stay absent');
  check(!('externally_connectable' in manifest), 'externally_connectable must stay absent');

  const allowedPermissions = new Set(['activeTab', 'scripting', 'storage', 'commands']);
  for (const permission of manifest.permissions ?? []) {
    check(allowedPermissions.has(permission), `unexpected permission: ${permission}`);
  }

  check(
    (manifest.host_permissions ?? []).length === 1 &&
      manifest.host_permissions[0] === 'https://api.deepseek.com/*',
    'host_permissions must stay scoped to https://api.deepseek.com/*',
  );

  const worker = manifest.background?.service_worker;
  check(Boolean(worker), 'background.service_worker is missing');
  if (worker) check(existsSync(join(root, worker)), `missing service worker: ${worker}`);

  const optionsPage = manifest.options_ui?.page;
  check(Boolean(optionsPage), 'options_ui.page is missing');
  if (optionsPage) check(existsSync(join(root, optionsPage)), `missing options page: ${optionsPage}`);

  check(Boolean(manifest.commands?.capture), 'commands.capture is missing');
}

const contentFiles = ['src/content/select.js', 'src/content/display.js'];
for (const relative of contentFiles) {
  const absolute = join(root, relative);
  check(existsSync(absolute), `missing content script: ${relative}`);
  if (!existsSync(absolute)) continue;

  const source = readFileSync(absolute, 'utf8');
  check(!/^\s*(import|export)\s/m.test(source), `${relative} must stay a classic script`);
  check(!/\beval\s*\(/.test(source), `${relative} must not call eval()`);
  check(!/\bnew\s+Function\b/.test(source), `${relative} must not build functions from strings`);
  check(source.startsWith('(() => {'), `${relative} must be wrapped in an IIFE`);
}

const workerPath = join(root, 'src/background/sw.js');
if (existsSync(workerPath)) {
  const worker = readFileSync(workerPath, 'utf8');
  for (const match of worker.matchAll(/src\/content\/[\w.-]+\.js/g)) {
    check(existsSync(join(root, match[0])), `sw.js references a missing file: ${match[0]}`);
  }
}

for (const relative of ['src/options/options.js', 'src/options/options.css']) {
  check(existsSync(join(root, relative)), `missing options asset: ${relative}`);
}

const promptPath = join(root, 'src/shared/prompt.js');
if (existsSync(promptPath)) {
  const prompt = readFileSync(promptPath, 'utf8');
  check(prompt.includes('【答案】'), 'prompt must request the answer marker');
  check(prompt.includes('【解析】'), 'prompt must request the explanation marker');
}

for (const file of walk(join(root, 'src'))) {
  if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
  const source = readFileSync(file, 'utf8');
  const specifiers = [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);

  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(file), specifier);
    const candidates = [target, `${target}.js`, `${target}.mjs`, join(target, 'index.js')];
    check(
      candidates.some((candidate) => existsSync(candidate)),
      `unresolved import "${specifier}" in ${file.slice(root.length + 1)}`,
    );
  }
}

if (problems.length > 0) {
  console.error(`check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('check OK');

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}
