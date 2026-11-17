import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { containerArgs, docker, isolationStatus } from '../dist/bounty/isolation.js';
import { startVpn } from '../dist/bounty/vpn.js';

// Diagnostic services only. Never execute a selected-target tool or an OpenAI call.
const directory = resolve(process.env.GHOSTHUNT_DATA_DIR || '.bounty/web');
const config = JSON.parse(await readFile(join(directory, 'runtime/config.json'), 'utf8'));
const quiet = { onStdout() {}, onStderr() {} };
async function checked(args, timeout = 15000) {
  const result = await docker(args, { ...quiet, timeout });
  assert.equal(result.code, 0, `Diagnostic Docker command failed: ${args[0]}`);
  return result.output.trim();
}
const busy = await checked(['ps', '--filter', 'label=app=ghosthunt-analysis', '--format', '{{.Names}}']);
assert.equal(busy, '', 'Wait for current analysis containers before disconnect testing');
const gateway = JSON.parse(await checked(['inspect', 'ghosthunt-vpn']))[0];
assert.equal(gateway.Config.Labels.app, 'ghosthunt-vpn');
assert.equal(gateway.Image, config.vpnImageId);
assert.equal(gateway.State.Health.Status, 'healthy');
const name = 'ghosthunt-job-' + randomUUID();
const args = containerArgs(config.imageId, name, gateway.Id, join(directory, 'runtime/resolv.conf'));
args.splice(args.length - 1, 0, '--detach', '--entrypoint', '/opt/conda/bin/python3');
args.push('-c', 'import time; time.sleep(180)');
const report = { verifiedAt: new Date().toISOString(), imageId: config.imageId };
let interrupted = false;
try {
  await checked(args);
  const baseline = `import os,json,hashlib,urllib.request,subprocess,pathlib,socket
route=json.loads(subprocess.check_output(['ip','-j','route','get','1.1.1.1']))
ip=urllib.request.urlopen('https://api.ipify.org',timeout=10).read().decode().strip()
trace=urllib.request.urlopen('https://1.1.1.1/cdn-cgi/trace',timeout=10).read().decode()
trace_ip=next(line[3:] for line in trace.splitlines() if line.startswith('ip='))
try:
 socket.create_connection(('2606:4700:4700::1111',443),timeout=2).close();ipv6_blocked=False
except OSError:ipv6_blocked=True
print(json.dumps({'uid':os.getuid(),'route':route[0]['dev'],'resolver':pathlib.Path('/etc/resolv.conf').read_text(),'exitIp':ip,'secondExitMatches':ip==trace_ip,'differentFromMac':hashlib.sha256(ip.encode()).hexdigest()!='${config.hostEgressHash}','ipv6Blocked':ipv6_blocked}))`;
  report.connected = JSON.parse(await checked(['exec', name, '/opt/conda/bin/python3', '-c', baseline], 30000));
  assert.equal(report.connected.uid, 1000);
  assert.match(report.connected.route, /^(tun|wg)[0-9]+$/);
  assert.equal(report.connected.resolver, 'nameserver 127.0.0.1\noptions timeout:2 attempts:2\n');
  for (const key of ['differentFromMac', 'secondExitMatches', 'ipv6Blocked']) assert.equal(report.connected[key], true, key);

  // Freeze the trusted gateway controller so it cannot heal the fault during the probe.
  // The network namespace/firewall stay alive; deleting tun0 exposes the fallback route.
  interrupted = true;
  await checked(['kill', '--signal=STOP', 'ghosthunt-vpn']);
  await checked(['exec', 'ghosthunt-vpn', 'ip', 'link', 'delete', report.connected.route]);
  const outage = `import socket,json,subprocess
route=json.loads(subprocess.check_output(['ip','-j','route','get','1.1.1.1']))
try:
 socket.create_connection(('1.1.1.1',443),timeout=3).close();blocked=False
except OSError:blocked=True
dns=subprocess.run(['dig','@1.1.1.1','example.com','+time=1','+tries=1'],capture_output=True,timeout=5)
print(json.dumps({'fallbackRoute':route[0]['dev'],'directIpTcpBlocked':blocked,'externalDnsBlocked':dns.returncode!=0}))`;
  report.disconnected = JSON.parse(await checked(['exec', name, '/opt/conda/bin/python3', '-c', outage]));
  assert.equal(report.disconnected.fallbackRoute, 'eth0');
  assert.equal(report.disconnected.directIpTcpBlocked, true);
  assert.equal(report.disconnected.externalDnsBlocked, true);
} finally {
  await docker(['rm', '--force', name], quiet);
  if (interrupted) {
    await docker(['kill', '--signal=CONT', 'ghosthunt-vpn'], quiet);
    await startVpn(directory);
  }
}
for (let attempt = 0; attempt < 12; attempt++) {
  const state = await isolationStatus(directory, true);
  if (state.networkReady) { report.restored = true; break; }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
assert.equal(report.restored, true, 'VPN must be restored after the diagnostic');
await mkdir(join(directory, 'verification'), { recursive: true, mode: 0o700 });
await writeFile(join(directory, 'verification/vpn-smoke.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
console.log('PASS: protected exit verified by two services; local resolver; IPv6 blocked; tunnel removed and fallback TCP/DNS blocked; VPN restored.');
