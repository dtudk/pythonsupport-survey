"""Rebuild the processed tables and the dashboard. Stops at the first error; outputs aren't saved.

    uv run --group pipeline python pipeline.py                   # on your machine, in notebooks/
    sudo /srv/pythonsupport-survey/deploy/manage.sh pipeline     # on the server
"""
import tempfile
from pathlib import Path

import nbclient
import nbformat
from traitlets.config import Config

NOTEBOOKS = [
    "processing/aggregated_customer_data.ipynb",
    "processing/new_proccess_data.ipynb",
    "visualization/dashboard.ipynb",
]

# Unix sockets in a private folder: over TCP, other users of the server could read the outputs.
with tempfile.TemporaryDirectory() as sockets:
    config = Config()
    config.KernelManager.transport = "ipc"
    config.KernelManager.ip = f"{sockets}/kernel"

    for name in NOTEBOOKS:
        path = Path(__file__).parent / name
        print("Running", name, flush=True)
        # In the notebook's folder, as in Jupyter.
        nbclient.execute(nbformat.read(path, as_version=4), cwd=path.parent, config=config)
