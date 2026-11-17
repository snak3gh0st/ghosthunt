import json,subprocess,shutil
from pathlib import Path
root=Path('/opt/ghosthunt');tool=json.loads((root/'arsenal-extra-lock.json').read_text())['commix'];destination=root/'commix'
def run(args):subprocess.run(args,check=True,timeout=300)
run(['git','init',str(destination)]);run(['git','-C',str(destination),'remote','add','origin',f'https://github.com/{tool["repository"]}.git']);run(['git','-C',str(destination),'fetch','--depth','1','origin',tool['commit']]);run(['git','-C',str(destination),'checkout','--detach','FETCH_HEAD']);shutil.rmtree(destination/'.git')
path=root/'data/bin/commix';path.write_text('#!/bin/sh\nexec /opt/conda/bin/python3 /opt/ghosthunt/commix/commix.py "$@"\n');path.chmod(0o755)
run(['chmod','-R','a+rX',str(destination)])
shutil.copyfile(root/'arsenal-extra-lock.json',root/'data/arsenal-extra-lock.json')
version=json.loads((root/'arsenal-extra-lock.json').read_text())['wpscanVersion']
subprocess.run(['gem','install','wpscan','--version',version,'--no-document'],check=True,timeout=600)
