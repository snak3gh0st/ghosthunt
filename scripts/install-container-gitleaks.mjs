import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, copyFile, chmod, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
if (process.platform !== 'linux' || !arch) throw Error('Linux arm64/x64 required');
const checksums = { arm64: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080', x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' };
const name = `gitleaks_8.30.1_linux_${arch}.tar.gz`;
const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/${name}`, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw Error(`Gitleaks HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== checksums[arch]) throw Error('Gitleaks checksum mismatch');
const folder = await mkdtemp(join(tmpdir(), 'ghosthunt-gitleaks-'));
try {
 await writeFile(join(folder, name), bytes);
 const result = spawnSync('tar', ['-xzf', join(folder, name), '-C', folder, 'gitleaks'], { encoding: 'utf8' });
 if (result.status) throw Error('Gitleaks extraction failed');
 const destination = join(process.env.GHOSTHUNT_DATA_DIR, 'bin', 'gitleaks');
 await copyFile(join(folder, 'gitleaks'), destination); await chmod(destination, 0o755);
 console.log('Gitleaks 8.30.1 installed; official SHA-256 verified');
} finally { await rm(folder, { recursive: true, force: true }); }
