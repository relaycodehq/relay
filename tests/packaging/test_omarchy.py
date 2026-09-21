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
        (payload / "review-relay").write_text("#!/bin/sh\nprintf '%s\\n' \"$@\"\n")
        (payload / "review-relay").chmod(0o755)
        (payload / "resources/app.asar").write_bytes(b"fixture application v1")
        (payload / "review-relay.png").write_bytes(b"fixture icon")
        (self.bundle / "install.py").write_bytes(installer_path.read_bytes())
        self.prefix = self.root / "Friend's apps $safe"
        self.data = self.root / "custom XDG data"
        self.refresh = patch.object(installer, "refresh")
        self.refresh.start()

    def tearDown(self):
        self.refresh.stop()
        self.temporary.cleanup()

    def install(self):
        installer.install(self.bundle, self.prefix, self.data)

    def test_install_update_launch_and_remove_keep_user_data(self):
        saved = self.root / "Review Relay/state.json"
        saved.parent.mkdir()
        saved.write_text('{"draft":"keep me"}')
        self.install()
        app, binary, desktop = installer.locations(self.prefix, self.data)
        literal = "reviewrelay-room://join?url=hello $(touch nope) 'quotes'"
        result = subprocess.run([str(binary), literal], capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), literal)
        self.assertIn('Exec="', desktop.read_text())
        self.assertIn('apps \\\\$safe/lib/review-relay-experimental/review-relay" %U', desktop.read_text())
        self.assertIn("MimeType=x-scheme-handler/reviewrelay-room;", desktop.read_text())
        (self.bundle / "app/resources/app.asar").write_bytes(b"fixture application v2")
        self.install()
        self.assertEqual((app / "resources/app.asar").read_bytes(), b"fixture application v2")
        installer.uninstall(self.prefix, self.data)
        self.assertFalse(app.exists())
        self.assertFalse(binary.is_symlink())
        self.assertFalse(desktop.exists())
        self.assertEqual(saved.read_text(), '{"draft":"keep me"}')

    def test_refuses_unrelated_existing_command_or_app(self):
        binary = self.prefix / "bin/review-relay-experimental"
        binary.parent.mkdir(parents=True)
        binary.write_text("some other app")
        with self.assertRaisesRegex(RuntimeError, "unrelated command"):
            self.install()
        self.assertEqual(binary.read_text(), "some other app")
        binary.unlink()
        app = self.prefix / "lib/review-relay-experimental"
        app.mkdir(parents=True)
        (app / "important.txt").write_text("keep this")
        with self.assertRaisesRegex(RuntimeError, "unrelated installation"):
            installer.uninstall(self.prefix, self.data)
        self.assertEqual((app / "important.txt").read_text(), "keep this")

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
