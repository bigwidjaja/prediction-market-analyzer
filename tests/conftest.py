import sys
from pathlib import Path

# The services are standalone scripts (each Dockerfile copies one file), not
# an installable package — put their directories on sys.path for the tests.
ROOT = Path(__file__).resolve().parent.parent
for service_dir in ("producer", "config_loader", "api"):
    sys.path.insert(0, str(ROOT / service_dir))
