"""Resolve official upstream metadata to a reviewable, immutable local toolkit lock."""
import concurrent.futures, hashlib, json, re, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
def fetch(url, binary=False):
    cache=ROOT/'.bounty/web/runtime/upstream-metadata'/hashlib.sha256(url.encode()).hexdigest()
    if not binary and cache.exists():return json.loads(cache.read_text())
    request=urllib.request.Request(url,headers={'User-Agent':'Ghosthunt-toolkit-setup'})
    with urllib.request.urlopen(request,timeout=120) as response:
        value=response.read()
    if not binary:
        cache.parent.mkdir(parents=True,exist_ok=True)
        cache.write_bytes(value)
    return value if binary else json.loads(value)
releases={
 'amass':'owasp-amass/amass','cdncheck':'projectdiscovery/cdncheck','dalfox':'hahwul/dalfox',
 'ffuf':'ffuf/ffuf','gobuster':'OJ/gobuster','gospider':'jaeles-project/gospider',
 'gowitness':'sensepost/gowitness','katana':'projectdiscovery/katana','naabu':'projectdiscovery/naabu',
 'nuclei':'projectdiscovery/nuclei','tlsx':'projectdiscovery/tlsx','crlfuzz':'dwisiswant0/crlfuzz',
 'kiterunner':'assetnote/kiterunner','trufflehog':'trufflesecurity/trufflehog',
 'feroxbuster':'epi052/feroxbuster','findomain':'Findomain/Findomain',
}
def release(item):
    name,repo=item
    data=fetch(f'https://api.github.com/repos/{repo}/releases/latest')
    def match(asset):
        value=asset['name'].lower()
        if name=='feroxbuster':return value=='aarch64-linux-feroxbuster.zip'
        if name=='findomain':return value=='findomain-aarch64-musl.zip'
        return 'linux' in value and ('arm64' in value or 'aarch64' in value) and not any(x in value for x in ['.sig','.pem','.sha256','checksum','.deb','.rpm'])
    asset=next((a for a in data['assets'] if match(a)),None)
    if not asset:raise RuntimeError(f'{name}: no upstream Linux ARM64 release')
    digest=asset.get('digest') or ''
    checksum=digest[7:] if digest.startswith('sha256:') else hashlib.sha256(fetch(asset['browser_download_url'],True)).hexdigest()
    print(f'{name}: {data["tag_name"]} / {asset["name"]}',flush=True)
    return {'id':name,'repository':repo,'version':data['tag_name'],'url':asset['browser_download_url'],'asset':asset['name'],'sha256':checksum,'binary': 'kr' if name=='kiterunner' else name}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    binaries=list(pool.map(release,releases.items()))
go=[]
for name,module in [('assetfinder','github.com/tomnomnom/assetfinder'),('hakrawler','github.com/hakluke/hakrawler'),('waybackurls','github.com/tomnomnom/waybackurls')]:
    escaped=''.join('!'+c.lower() if c.isupper() else c for c in module)
    version=fetch(f'https://proxy.golang.org/{escaped}/@latest')['Version']
    go.append({'id':name,'module':module,'version':version})
packages=[]
for name in ['arjun','semgrep','wafw00f','uv']:
    data=fetch(f'https://pypi.org/pypi/{name}/json')
    packages.append({'id':name,'version':data['info']['version'],'source':f'https://pypi.org/project/{name}/'})
sources=[]
for name,repo in [('netexec','Pennyw0rth/NetExec'),('theHarvester','laramies/theHarvester')]:
    sha=fetch(f'https://api.github.com/repos/{repo}/commits/HEAD')['sha']
    sources.append({'id':name,'repository':repo,'commit':sha})
msf=fetch('https://api.github.com/repos/rapid7/metasploit-framework/commits/HEAD')['sha']
lock={'platform':'linux/arm64','goBuilder':'golang@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea','binaries':binaries,'go':go,'python':packages,'sources':sources,'metasploit':{'repository':'rapid7/metasploit-framework','commit':msf}}
(ROOT/'arsenal-lock.json').write_text(json.dumps(lock,indent=2)+'\n')
print(f'Locked {len(binaries)} upstream binaries, {len(go)} Go builds, {len(packages)} Python packages, {len(sources)} source packages and Metasploit commit {msf}.',flush=True)
