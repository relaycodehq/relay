import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

installer_path = Path(__file__).resolve().parents[2] / "packaging/omarchy/install.py"
spec = importlib.util.spec_from_file_location("omarchy_installer", installer_path)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class OmarchyInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="relay-install-test-")
        self.root = Path(self.temporary.name)
        self.bundle = self.root / "bundle"
        payload = self.bundle / "app"
        (payload / "resources").mkdir(parents=True)
        (payload / "relay-experimental").write_text("#!/bin/sh\nprintf '%s\\n' \"$@\"\n")
        (payload / "relay-experimental").chmod(0o755)
        (payload / "resources/app.asar").write_bytes(b"fixture application v1")
        (payload / "relay-experimental.svg").write_text("<svg/>")
        (payload / "VERSION").write_text("0.1.7\n")
        (self.bundle / "install.py").write_bytes(installer_path.read_bytes())
        self.prefix = self.root / "Friend's apps $safe"
        self.data = self.root / "custom XDG data"
        self.config = self.root / "config"
        self.refresh = patch.object(installer, "refresh")
        self.refresh.start()

    def tearDown(self):
        self.refresh.stop()
        self.temporary.cleanup()

    def install(self):
        installer.install(self.bundle, self.prefix, self.data)

    def run_main(self, *args):
        env = {"HOME": str(self.root), "XDG_DATA_HOME": str(self.data), "XDG_CONFIG_HOME": str(self.config)}
        with patch.dict("os.environ", env), patch("sys.argv", ["install.py", *args]), \
                patch.object(installer.sys, "platform", "linux"), \
                patch.object(installer.platform, "machine", return_value="x86_64"), \
                patch.object(installer.os, "geteuid", return_value=1000), \
                patch.object(installer, "__file__", str(self.bundle / "install.py")):
            installer.main()

    def test_install_update_launch_and_remove_keep_user_data(self):
        saved = self.root / "Relay/state.json"
        saved.parent.mkdir()
        saved.write_text('{"draft":"keep me"}')
        self.install()
        app, binary, desktop = installer.locations(self.prefix, self.data)
        literal = "relay-room://join?url=hello $(touch nope) 'quotes'"
        result = subprocess.run([str(binary), literal], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), literal)
        self.assertIn('Exec="', desktop.read_text())
        self.assertIn('apps \\\\$safe/lib/relay-experimental/relay-experimental" %U', desktop.read_text())
        self.assertIn("MimeType=x-scheme-handler/relay-room;", desktop.read_text())
        self.assertIn("StartupWMClass=relay-experimental", desktop.read_text().splitlines())
        self.assertIn("Icon=relay-experimental", desktop.read_text().splitlines())
        self.assertEqual((app / "VERSION").read_text(), "0.1.7\n")
        self.assertTrue(installer.icon_path(self.data).is_file())
        (self.bundle / "app/resources/app.asar").write_bytes(b"fixture application v2")
        self.install()
        self.assertEqual((app / "resources/app.asar").read_bytes(), b"fixture application v2")
        installer.uninstall(self.prefix, self.data)
        self.assertFalse(app.exists())
        self.assertFalse(binary.is_symlink())
        self.assertFalse(desktop.exists())
        self.assertFalse(installer.icon_path(self.data).exists())
        self.assertEqual(saved.read_text(), '{"draft":"keep me"}')

    def test_custom_prefix_still_registers_where_launchers_look(self):
        self.run_main("--prefix", str(self.prefix))
        self.assertTrue((self.prefix / "bin/relay-experimental").is_symlink())
        self.assertTrue((self.data / "applications/relay-experimental.desktop").is_file())
        self.assertFalse((self.prefix / "share").exists())

    def test_purge_also_removes_user_data(self):
        saved = self.config / installer.USER_DATA / "state.json"
        saved.parent.mkdir(parents=True)
        saved.write_text("{}")
        self.run_main("--prefix", str(self.prefix))
        self.run_main("--prefix", str(self.prefix), "--purge")
        self.assertFalse((self.prefix / "lib/relay-experimental").exists())
        self.assertFalse(saved.parent.exists())

    def test_refuses_unrelated_existing_command_or_app(self):
        binary = self.prefix / "bin/relay-experimental"
        binary.parent.mkdir(parents=True)
        binary.write_text("some other app")
        with self.assertRaisesRegex(RuntimeError, "unrelated command"):
            self.install()
        self.assertEqual(binary.read_text(), "some other app")
        binary.unlink()
        app = self.prefix / "lib/relay-experimental"
        app.mkdir(parents=True)
        (app / "important.txt").write_text("keep this")
        with self.assertRaisesRegex(RuntimeError, "unrelated installation"):
            installer.uninstall(self.prefix, self.data)
        self.assertEqual((app / "important.txt").read_text(), "keep this")

    def test_takes_over_the_appimage_launcher(self):
        desktop = self.data / "applications/relay-experimental.desktop"
        desktop.parent.mkdir(parents=True)
        desktop.write_text("[Desktop Entry]\nExec=/old/Relay.AppImage\nX-Relay-AppImage=1\n")
        self.install()
        self.assertIn(installer.DESKTOP_MARKER, desktop.read_text().splitlines())
        self.assertNotIn("AppImage", desktop.read_text())

    def test_failed_update_restores_previous_installation(self):
        self.install()
        app, binary, desktop = installer.locations(self.prefix, self.data)
        before = desktop.read_bytes()
        (self.bundle / "app/resources/app.asar").write_bytes(b"new version")
        write_text = Path.write_text

        def fail_launcher(path, *args, **kwargs):
            if path == desktop:
                raise OSError("simulated disk failure")
            return write_text(path, *args, **kwargs)

        with patch.object(Path, "write_text", fail_launcher):
            with self.assertRaisesRegex(OSError, "disk failure"):
                self.install()
        self.assertEqual((app / "resources/app.asar").read_bytes(), b"fixture application v1")
        self.assertEqual(desktop.read_bytes(), before)
        self.assertTrue(binary.exists())


if __name__ == "__main__":
    unittest.main()
