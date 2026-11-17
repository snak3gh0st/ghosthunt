"""Keep Dirsearch's legacy pkg_resources dependency in its own compatible environment."""
import os,subprocess
from pathlib import Path
root=Path('/opt/ghosthunt');uv=str(root/'uv/bin/uv')
env={**os.environ,'UV_TOOL_DIR':str(root/'tool-envs'),'UV_TOOL_BIN_DIR':str(root/'data/bin'),'UV_PYTHON_INSTALL_DIR':str(root/'python')}
subprocess.run([uv,'tool','install','--python','/opt/conda/bin/python3','--with','setuptools==80.9.0','dirsearch==0.5.0'],env=env,check=True,timeout=600)
subprocess.run(['chmod','-R','a+rX',str(root/'tool-envs')],check=True)
