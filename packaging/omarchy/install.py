#!/usr/bin/env python3
"""Install the bundled app for the current user; never touch review/account data."""
import argparse
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile


# Installation identifiers stay stable so existing installs update in place.
MARKER = "Review Relay Experimental user installation v1\n"
DESKTOP_MARKER = "X-ReviewRelay-Experimental-Installer=1"


def desktop_command(path):
    # Desktop Entry string escaping happens before Exec argument unquoting.
    value = str(path)
    for char in ('\\', '"', '`', '$'):
        value = value.replace(char, '\\' + char)
    return '"' + value.replace('\\', '\\\\').replace('%', '%%') + '"'


def locations(prefix, data_dir):
    app = prefix / "lib/review-relay-experimental"
    binary = prefix / "bin/review-relay-experimental"
    desktop = data_dir / "applications/review-relay-experimental.desktop"
    for path in (app, binary, desktop):
        if any(char in str(path) for char in "\n\r\t="):
            raise RuntimeError("Installation paths cannot contain control characters or '='.")
    if app.exists() or app.is_symlink():
        if app.is_symlink() or not (app / ".installer").is_file() or (app / ".installer").read_text() != MARKER:
            raise RuntimeError(f"Refusing to replace an unrelated installation: {app}")
    if binary.exists() or binary.is_symlink():
        if not binary.is_symlink() or os.readlink(binary) != str(app / "review-relay"):
            raise RuntimeError(f"An unrelated command already exists: {binary}")
    if desktop.exists() or desktop.is_symlink():
        if desktop.is_symlink() or DESKTOP_MARKER not in desktop.read_text().splitlines():
            raise RuntimeError(f"An unrelated app launcher already exists: {desktop}")
    return app, binary, desktop


def refresh(desktop):
    command = shutil.which("update-desktop-database")
    if command:
        subprocess.run([command, str(desktop.parent)], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    mime = shutil.which("xdg-mime")
    if mime and desktop.exists():
        subprocess.run([mime, "default", desktop.name, "x-scheme-handler/reviewrelay-room"], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def install(bundle, prefix, data_dir):
    app, binary, desktop = locations(prefix, data_dir)
    source = bundle / "app"
    if not (source / "review-relay").is_file() or not (source / "resources/app.asar").is_file():
        raise RuntimeError("The app payload is missing. Extract the complete download first.")
    for directory in (app.parent, binary.parent, desktop.parent):
        directory.mkdir(parents=True, exist_ok=True)
    desktop_contents = "\n".join([
        "[Desktop Entry]", "Type=Application", "Version=1.0",
        "Name=Relay", "Comment=Chat about projects, edit code and review pull requests",
        f"Exec={desktop_command(app / 'review-relay')} %U",
        f"Icon={str(app / 'review-relay.png').replace(chr(92), chr(92) * 2)}",
        "Terminal=false", "Categories=Development;",
        "StartupWMClass=review-relay", "MimeType=x-scheme-handler/reviewrelay-room;",
        DESKTOP_MARKER, "",
    ])
    old_desktop = desktop.read_bytes() if desktop.exists() else None
    had_binary = binary.is_symlink()
    with tempfile.TemporaryDirectory(prefix=".review-relay-", dir=app.parent) as staging:
        staging = Path(staging)
        prepared, previous = staging / "new", staging / "previous"
        shutil.copytree(source, prepared, symlinks=True)
        shutil.copyfile(bundle / "install.py", prepared / "install.py")
        (prepared / ".installer").write_text(MARKER)
        if app.exists():
            app.rename(previous)
        try:
            prepared.rename(app)
            if not had_binary:
                binary.symlink_to(app / "review-relay")
            desktop.write_text(desktop_contents)
            desktop.chmod(0o644)
        except Exception:
            if app.exists():
                shutil.rmtree(app)
            if previous.exists():
                previous.rename(app)
            if not had_binary and binary.is_symlink():
                binary.unlink()
            if old_desktop is None:
                desktop.unlink(missing_ok=True)
            else:
                desktop.write_bytes(old_desktop)
            raise
    refresh(desktop)
    print(f"Installed Relay. Find it in your app launcher, or run:\n{binary}")
    print("Your login, settings and review progress are kept between updates.")


def uninstall(prefix, data_dir):
    app, binary, desktop = locations(prefix, data_dir)
    binary.unlink(missing_ok=True)
    desktop.unlink(missing_ok=True)
    if app.exists():
        shutil.rmtree(app)
    refresh(desktop)
    print("Removed Relay. Saved login, settings and review progress were kept.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--prefix", type=Path, help="Installation prefix (default: ~/.local)")
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("This download is for Linux x86_64 (Intel/AMD), including Omarchy.")
    if os.geteuid() == 0:
        raise RuntimeError("Run this as your regular desktop user, without sudo.")
    prefix = (args.prefix or Path.home() / ".local").expanduser().resolve()
    data_dir = prefix / "share" if args.prefix else Path(os.environ.get("XDG_DATA_HOME") or prefix / "share").expanduser().resolve()
    if args.uninstall:
        uninstall(prefix, data_dir)
    else:
        install(Path(__file__).resolve().parent, prefix, data_dir)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        sys.exit(f"Could not install/uninstall Relay: {error}")
