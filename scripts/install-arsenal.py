"""Install locked upstream tools inside the disposable image build, never on the Mac."""
import concurrent.futures,hashlib,io,json,os,shutil,subprocess,sys,tarfile,urllib.request,zipfile
from pathlib import Path
root=Path('/opt/ghosthunt');lock=json.loads((root/'arsenal-lock.json').read_text());binary_dir=root/'data/bin';binary_dir.mkdir(parents=True,exist_ok=True)
def binary(tool):
    request=urllib.request.Request(tool['url'],headers={'User-Agent':'Ghosthunt-toolkit-setup'})
    with urllib.request.urlopen(request,timeout=180) as response:content=response.read(350_000_001)
    if len(content)>350_000_000:raise RuntimeError('Release too large')
    if hashlib.sha256(content).hexdigest()!=tool['sha256']:raise RuntimeError(f'{tool["id"]}: SHA-256 mismatch')
    name=tool['binary']
    if tool['asset'].endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            candidates=[entry for entry in archive.infolist() if Path(entry.filename).name==name and not entry.is_dir()]
            if len(candidates)!=1:raise RuntimeError(f'{name}: ambiguous archive')
            content=archive.read(candidates[0])
    elif tool['asset'].endswith(('.tar.gz','.tgz')):
        with tarfile.open(fileobj=io.BytesIO(content),mode='r:gz') as archive:
            candidates=[entry for entry in archive.getmembers() if Path(entry.name).name==name and entry.isfile()]
            if len(candidates)!=1:raise RuntimeError(f'{name}: ambiguous archive')
            content=archive.extractfile(candidates[0]).read()
    destination=binary_dir/tool['id'];destination.write_bytes(content);destination.chmod(0o755)
    if tool['id']=='kiterunner':(binary_dir/'kr').symlink_to(destination)
    print(f'Installed {tool["id"]} {tool["version"]}; pinned SHA-256 verified',flush=True)
if sys.argv[-1]=='binaries':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(binary,lock['binaries']))
    sys.exit(0)
def run(args,**kwargs):subprocess.run(args,check=True,timeout=1200,**kwargs)
if sys.argv[-1]=='metasploit':
    destination=root/'metasploit';destination.mkdir(exist_ok=True)
    run(['git','init',str(destination)]);run(['git','-C',str(destination),'remote','add','origin','https://github.com/rapid7/metasploit-framework.git'])
    run(['git','-C',str(destination),'fetch','--depth','1','origin',lock['metasploit']['commit']]);run(['git','-C',str(destination),'checkout','--detach','FETCH_HEAD'])
    lines=(destination/'Gemfile.lock').read_text().splitlines();bundler=lines[lines.index('BUNDLED WITH')+1].strip()
    run(['gem','install','bundler','--version',bundler,'--no-document'])
    run(['bundle','config','set','--local','path',str(root/'msf-gems')],cwd=destination)
    run(['bundle','config','set','--local','without','development test coverage'],cwd=destination)
    run(['bundle','install','--jobs','2','--retry','2'],cwd=destination)
    for name in ['msfconsole','msfvenom']:
        path=binary_dir/name;path.write_text(f'#!/bin/sh\ncd /opt/ghosthunt/metasploit || exit 1\nexec bundle exec ruby {name} "$@"\n');path.chmod(0o755)
    shutil.rmtree(destination/'.git')
    run(['chmod','-R','a+rX',str(destination),str(root/'msf-gems')])
    sys.exit(0)
uv_version=next(tool['version'] for tool in lock['python'] if tool['id']=='uv')
run(['/opt/conda/bin/python3','-m','venv',str(root/'uv')])
run([str(root/'uv/bin/pip'),'install','--no-cache-dir',f'uv=={uv_version}'])
uv=str(root/'uv/bin/uv');(binary_dir/'uv').symlink_to(uv)
env={**os.environ,'UV_TOOL_DIR':str(root/'tool-envs'),'UV_TOOL_BIN_DIR':str(binary_dir),'UV_PYTHON_INSTALL_DIR':str(root/'python')}
for tool in lock['python']:
    if tool['id']=='uv':continue
    print(f'Installing isolated Python tool {tool["id"]} {tool["version"]}',flush=True)
    run([uv,'tool','install','--python','/opt/conda/bin/python3',f'{tool["id"]}=={tool["version"]}'],env=env)
for tool in lock['sources']:
    python='3.14' if tool['id']=='theHarvester' else '/opt/conda/bin/python3'
    print(f'Installing source-pinned {tool["id"]} {tool["commit"][:12]}',flush=True)
    run([uv,'tool','install','--python',python,f'git+https://github.com/{tool["repository"]}.git@{tool["commit"]}'],env=env)
if (binary_dir/'nxc').exists() and not (binary_dir/'netexec').exists():(binary_dir/'netexec').symlink_to(binary_dir/'nxc')
if (binary_dir/'theHarvester').exists():(binary_dir/'theharvester').symlink_to(binary_dir/'theHarvester')
(binary_dir/'getallurls').symlink_to(binary_dir/'gau')
shutil.copyfile(root/'arsenal-lock.json',root/'data/arsenal-lock.json')
run(['chmod','-R','a+rX',str(root/'tool-envs'),str(root/'python'),str(root/'uv')])
print('Extended arsenal installed in the image. No target operation was started.',flush=True)
