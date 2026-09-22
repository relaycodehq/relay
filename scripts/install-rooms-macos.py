#!/usr/bin/env python3
"""Install the bundled room server as the current Mac user's login service."""
import argparse
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

LABEL = "dev.reviewrelay.rooms.experimental"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--uninstall", action="store_true", help="Stop and remove the login service; keep messages and setup key")
parser.add_argument("--gitea-server", action="append", help="Trusted Gitea HTTPS base URL, including any prefix; repeat for more than one host")
args = parser.parse_args()
if sys.platform != "darwin" or os.geteuid() == 0:
    sys.exit("Run this as your normal Mac user, without sudo.")
root = Path.home() / "Library/Application Support/Review Relay Rooms"
agent = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
domain = f"gui/{os.getuid()}"
if args.uninstall:
    if agent.exists():
        subprocess.run(["launchctl", "bootout", domain, str(agent)], check=False)
        agent.unlink()
    print(f"Server stopped. Messages and setup key are preserved in {root}")
    sys.exit(0)
source = Path(__file__).resolve().parent
if not (source / "server.mjs").is_file():
    sys.exit("Run the installer from the extracted ReviewRelay-RoomServer folder.")
node = shutil.which("node")
if not node:
    sys.exit("Install Node.js 22.16 or newer first, then run this installer again.")
version = subprocess.check_output([node, "-p", "process.versions.node"], text=True).strip().split(".")
if (int(version[0]), int(version[1])) < (22, 16):
    sys.exit("Node.js 22.16 or newer is required.")
previous = {}
if agent.exists():
    with agent.open("rb") as stream:
        previous = plistlib.load(stream)
    if previous.get("Label") != LABEL or previous.get("WorkingDirectory") != str(root):
        sys.exit(f"Refusing to replace an unrelated service: {agent}")
servers = args.gitea_server or previous.get("EnvironmentVariables", {}).get("RELAY_ROOMS_GITEA_SERVERS", "").split(",")
servers = [server.strip().rstrip("/") for server in servers if server.strip()]
if not servers:
    sys.exit("Specify --gitea-server https://your-gitea.example/base-path. The server must be able to reach it; existing service was left running.")
for server in servers:
    url = urlsplit(server)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or "," in server:
        sys.exit("Use a trusted HTTPS Gitea base URL without credentials, query or fragment. Existing service was left running.")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
marker = root / ".review-relay-rooms"
if any(root.iterdir()) and not marker.exists():
    sys.exit(f"Refusing to replace an unrelated directory: {root}")
marker.touch(mode=0o600)
setup = root / "setup-key.txt"
if not setup.exists():
    fd = os.open(setup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(secrets.token_urlsafe(32) + "\n")
if agent.exists():
    subprocess.run(["launchctl", "bootout", domain, str(agent)], check=False)
shutil.copy2(source / "server.mjs", root / "server.mjs")
agent.parent.mkdir(parents=True, exist_ok=True)
config = {
    "Label": LABEL,
    "ProgramArguments": [node, str(root / "server.mjs")],
    "WorkingDirectory": str(root),
    "EnvironmentVariables": {"HOST": "127.0.0.1", "PORT": "4319", "RELAY_ROOMS_DB": str(root / "rooms.sqlite"), "RELAY_ROOMS_SETUP_KEY_FILE": str(setup), "RELAY_ROOMS_GITEA_SERVERS": ",".join(servers)},
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "StandardOutPath": str(root / "server.log"),
    "StandardErrorPath": str(root / "server-error.log"),
}
with agent.open("wb") as stream:
    plistlib.dump(config, stream)
os.chmod(agent, 0o600)
subprocess.run(["launchctl", "bootstrap", domain, str(agent)], check=True)
print("Relay room server installed at http://127.0.0.1:4319")
print(f"Setup key: {setup} (keep private; use it only to create projects)")
print("For colleagues, place an HTTPS reverse proxy or a private HTTPS tunnel in front of port 4319.")
print("The server starts when this Mac user logs in. Keep the Mac awake while others are connected.")
