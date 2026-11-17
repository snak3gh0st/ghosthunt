import json,os,subprocess
from pathlib import Path
lock=json.loads(Path('arsenal-lock.json').read_text())
Path('/out').mkdir(exist_ok=True)
env={**os.environ,'GOBIN':'/out','CGO_ENABLED':'0','GOMAXPROCS':'2','GOFLAGS':'-p=2'}
for tool in lock['go']:
    print(f'Building {tool["id"]} {tool["version"]}',flush=True)
    subprocess.run(['go','install',f'{tool["module"]}@{tool["version"]}'],env=env,check=True,timeout=900)
