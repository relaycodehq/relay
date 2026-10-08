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


# Also the executable, desktop id and Wayland app_id (package.json's desktopName).
NAME = "relay-experimental"
MARKER = "Relay Experimental user installation v1\n"
DESKTOP_MARKER = "X-Relay-Experimental-Installer=1"
# The AppImage writes the same launcher id; installing takes it over.
APPIMAGE_MARKER = "X-Relay-AppImage=1"
# Electron's userData folder name.
USER_DATA = "Relay Experimental"


def desktop_command(path):
    # Desktop Entry string escaping happens before Exec argument unquoting.
    value = str(path)
    for char in ('\\', '"', '`', '$'):
        value = value.replace(char, '\\' + char)
    return '"' + value.replace('\\', '\\\\').replace('%', '%%') + '"'


def locations(prefix, data_dir):
    app = prefix / "lib" / NAME
    binary = prefix / "bin" / NAME
    desktop = data_dir / f"applications/{NAME}.desktop"
    for path in (app, binary, desktop):
        if any(char in str(path) for char in "\n\r\t="):
            raise RuntimeError("Installation paths cannot contain control characters or '='.")
    if app.exists() or app.is_symlink():
        if app.is_symlink() or not (app / ".installer").is_file() or (app / ".installer").read_text() != MARKER:
            raise RuntimeError(f"Refusing to replace an unrelated installation: {app}")
    if binary.exists() or binary.is_symlink():
        if not binary.is_symlink() or os.readlink(binary) != str(app / NAME):
            raise RuntimeError(f"An unrelated command already exists: {binary}")
    if desktop.exists() or desktop.is_symlink():
        lines = [] if desktop.is_symlink() else desktop.read_text().splitlines()
        if DESKTOP_MARKER not in lines and APPIMAGE_MARKER not in lines:
            raise RuntimeError(f"An unrelated app launcher already exists: {desktop}")
    return app, binary, desktop


def icon_path(data_dir):
    return data_dir / f"icons/hicolor/scalable/apps/{NAME}.svg"


def refresh(desktop):
    command = shutil.which("update-desktop-database")
    if command:
        subprocess.run([command, str(desktop.parent)], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def install(bundle, prefix, data_dir):
    app, binary, desktop = locations(prefix, data_dir)
    source = bundle / "app"
    if not all((source / name).is_file() for name in (NAME, "resources/app.asar", "VERSION", f"{NAME}.svg")):
        raise RuntimeError("The app payload is missing. Extract the complete download first.")
    version = (source / "VERSION").read_text().strip()
    icon = icon_path(data_dir)
    for directory in (app.parent, binary.parent, desktop.parent, icon.parent):
        directory.mkdir(parents=True, exist_ok=True)
    desktop_contents = "\n".join([
        "[Desktop Entry]", "Type=Application", "Version=1.0",
        "Name=Relay", "Comment=Chat about projects, edit code and review pull requests",
        f"Exec={desktop_command(app / NAME)} %U",
        f"Icon={NAME}",
        "Terminal=false", "Categories=Development;",
        f"StartupWMClass={NAME}",
        DESKTOP_MARKER, "",
    ])
    old_desktop = desktop.read_bytes() if desktop.exists() else None
    had_binary = binary.is_symlink()
    with tempfile.TemporaryDirectory(prefix=f".{NAME}-", dir=app.parent) as staging:
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
                binary.symlink_to(app / NAME)
            desktop.write_text(desktop_contents)
            desktop.chmod(0o644)
            shutil.copyfile(app / f"{NAME}.svg", icon)
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
    print(f"Installed Relay {version}. Find it in your app launcher, or run:\n{binary}")
    print("Your login, settings and review progress are kept between updates.")


def uninstall(prefix, data_dir, user_data=None):
    app, binary, desktop = locations(prefix, data_dir)
    binary.unlink(missing_ok=True)
    desktop.unlink(missing_ok=True)
    icon_path(data_dir).unlink(missing_ok=True)
    if app.exists():
        shutil.rmtree(app)
    refresh(desktop)
    if user_data is None:
        print("Removed Relay. Saved login, settings and review progress were kept.")
        return
    if user_data.exists():
        shutil.rmtree(user_data)
    print(f"Removed Relay and its data in {user_data}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uninstall", action="store_true")
    parser.add_argument("--purge", action="store_true",
                        help="Uninstall and also delete settings, drafts and review progress")
    parser.add_argument("--prefix", type=Path, help="Installation prefix (default: ~/.local)")
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "amd64"):
        raise RuntimeError("This download is for Linux x86_64 (Intel/AMD), including Omarchy.")
    if os.geteuid() == 0:
        raise RuntimeError("Run this as your regular desktop user, without sudo.")
    prefix = (args.prefix or Path.home() / ".local").expanduser().resolve()
    # Launchers only look in XDG data dirs, so a custom prefix still registers there.
    data_dir = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share").expanduser().resolve()
    if args.purge:
        config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config").expanduser().resolve()
        uninstall(prefix, data_dir, config / USER_DATA)
    elif args.uninstall:
        uninstall(prefix, data_dir)
    else:
        install(Path(__file__).resolve().parent, prefix, data_dir)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        sys.exit(f"Could not install/uninstall Relay: {error}")
