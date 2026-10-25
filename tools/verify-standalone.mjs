// Packaging check only. Does not access cameras, Chrome, or any remote server.
import { cp, mkdtemp, rm, readdir, readFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'hikvision-standalone-'));
const selected = process.argv.slice(2);
const versions = selected.length ? selected : ['v1', 'v2', 'v3', 'linux'];
assert.ok(versions.every(name => ['v1', 'v2', 'v3', 'linux'].includes(name)));
const omitted = new Set(['.local', 'node_modules', 'data', 'log', 'logs', 'captures', '__pycache__', '.git', 'reports']);
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.filter(e => !omitted.has(e.name)).map(e => e.isDirectory()
    ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}
async function run(command, args, cwd) {
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(output || `Exit ${code}`)));
  });
  console.log(output.trim().split(/\r?\n/).slice(-10).join('\n'));
}
try {
  for (const version of versions) {
    const source = path.join(root, version), target = path.join(temporary, version);
    await cp(source, target, { recursive: true, filter: file => !omitted.has(path.basename(file)) && !path.basename(file).startsWith('.env') });
    for (const file of await files(target)) {
      if (!file.endsWith('.mjs')) continue;
      const code = await readFile(file, 'utf8');
      for (const [, specifier] of code.matchAll(/(?:from\s*|import\s*|new URL\(\s*)['"](\.[^'"]+)['"]/g)) {
        const dependency = path.resolve(path.dirname(file), specifier);
        assert.ok(dependency === target || dependency.startsWith(target + path.sep), `${version}: dependency escapes app: ${specifier}`);
        // Optional browser automation packages are documented dev prerequisites.
        if (dependency.includes(path.sep + '.local' + path.sep)) continue;
        await access(dependency);
      }
    }
    if (version === 'v3') {
      // Existing installed, locked dependencies; no package downloads or upgrades.
      await cp(path.join(source, 'node_modules'), path.join(target, 'node_modules'), { recursive: true });
      // Same-user encrypted fixture credential only; never copied into source/Git.
      await mkdir(path.join(target, '.local'));
      await cp(path.join(source, '.local/database-admin.dpapi'), path.join(target, '.local/database-admin.dpapi'));
    }
    const packageInfo = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    let tests = ['test/*.test.mjs'];
    if (version === 'linux' && process.platform !== 'linux') {
      tests = packageInfo.scripts['test:portable'].replace(/^node --test /, '').split(' ');
      console.log('Linux: running portable tests only; Wine, POSIX vault and pool integration need Linux.');
    }
    console.log(`\n${version}: testing an isolated copy outside the workspace`);
    await run(process.execPath, ['--test', ...tests], target);
    const native = version === 'v3' ? 'vendor/windows-sdk/native' : 'native';
    for (const script of version === 'v1' ? ['test_audio.py'] : ['test_audio.py', 'test_smooth.py']) {
      await run(process.env.HIK_PYTHON || 'python', [path.join(native, script)], target);
    }
    console.log(`${version}: no sibling source required; isolated checks passed.`);
  }
} finally {
  const resolved = path.resolve(temporary);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('hikvision-standalone-'));
  await rm(resolved, { recursive: true, force: true });
}
