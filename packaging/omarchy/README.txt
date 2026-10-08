Relay for Omarchy — Linux x86_64 (Intel / AMD)

INSTALL

1. Extract the Relay-<version>-omarchy-x86_64.tar.gz download.
2. Open a terminal in the extracted Relay-Omarchy-x86_64 folder.
3. Run:

   python3 install.py

Run it as your normal user, without sudo. Then search for Relay in
your app launcher. You can also start it with ~/.local/bin/relay-experimental.
No Node, Docker, build tools, or FUSE/AppImage setup is needed.

SIGN IN

Enter your Gitea server's HTTPS URL (including /gitea if it uses a subpath)
and your own personal access token. The app links to Gitea's token page.
Use read:user, write:repository and write:issue permissions, plus access to
the repositories you want to review. This download contains no account,
token, private project files, or review history.

Codex features are optional: install and sign into Codex CLI separately.
Grouping uses that login. Ask/Fix Codex also requires linking a local Git
checkout. Sessions open through Omarchy's configured terminal using
xdg-terminal-exec. Choose model, reasoning effort and Fast mode in Settings.

UPDATES / REMOVE

Relay updates itself. To update by hand, quit Relay and run the installer
from a newer download. Your login, local drafts, settings and viewed-file
progress are preserved.

The installed version is in ~/.local/lib/relay-experimental/VERSION.

The installer owns only ~/.local/lib/relay-experimental, the
~/.local/bin/relay-experimental command, and the relay-experimental.desktop
launcher and relay-experimental.svg icon in your XDG data directory
(~/.local/share unless XDG_DATA_HOME is set). With --prefix, the app and
command go under that prefix; the launcher and icon still go to the XDG data
directory so app launchers find them.

To uninstall, quit the app and run:

   python3 ~/.local/lib/relay-experimental/install.py --uninstall

Uninstall leaves your review data in ~/.config/Relay Experimental (or your
XDG_CONFIG_HOME) so you can reinstall without losing drafts. To remove that
too, use --purge instead of --uninstall. The saved login in your system
keyring is not removed.

TROUBLESHOOTING

- If the launcher has not refreshed yet, log out and back in, or run the
  command above directly.
- If a library is missing, use ldd ~/.local/lib/relay-experimental/relay-experimental
  to identify it. Standard Omarchy desktop packages provide the Electron
  GTK/NSS/GBM dependencies. Keep the system current with Omarchy's updater.
- Secure saved login needs an unlocked system keyring. Without a secure
  keyring the app keeps the token only for that session.
- Chromium's sandbox stays enabled. This user install requires Linux user
  namespaces; if a hardened system disables them, ask its administrator to
  configure sandbox support. Do not run the app as root or use --no-sandbox.
- If code checks are unavailable, install the linked project's dependencies
  normally first. Relay never runs project install scripts for you.

Source and third-party licenses are included with the release/source tree.
Electron and Chromium licenses are in app/. Relay's license and
third-party notices are alongside this file and within app/resources/app.asar.
