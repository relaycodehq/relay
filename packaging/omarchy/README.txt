Review Relay Experimental for Omarchy — Linux x86_64 (Intel / AMD)

INSTALL

1. Extract ReviewRelay-Experimental-Omarchy-x86_64.tar.gz.
2. Open a terminal in the extracted ReviewRelay-Experimental-Omarchy-x86_64 folder.
3. Run:

   python3 install.py

Run it as your normal user, without sudo. Then search for Review Relay in
your app launcher. You can also start it with ~/.local/bin/review-relay-experimental.
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

Quit Review Relay and run the installer from a newer download to update.
Your login, local drafts, settings and viewed-file progress are preserved.
The installer owns only ~/.local/lib/review-relay-experimental, its ~/.local/bin command
and the review-relay-experimental.desktop launcher in your XDG applications directory.

To uninstall, quit the app and run:

   python3 ~/.local/lib/review-relay-experimental/install.py --uninstall

Uninstall leaves your review data in ~/.config/Review Relay Experimental (or your
XDG_CONFIG_HOME) so you can reinstall without losing drafts.

TROUBLESHOOTING

- If the launcher has not refreshed yet, log out and back in, or run the
  command above directly.
- If a library is missing, use ldd ~/.local/lib/review-relay-experimental/review-relay
  to identify it. Standard Omarchy desktop packages provide the Electron
  GTK/NSS/GBM dependencies. Keep the system current with Omarchy's updater.
- Secure saved login needs an unlocked system keyring. Without a secure
  keyring the app keeps the token only for that session.
- Chromium's sandbox stays enabled. This user install requires Linux user
  namespaces; if a hardened system disables them, ask its administrator to
  configure sandbox support. Do not run the app as root or use --no-sandbox.
- If code checks are unavailable, install the linked project's dependencies
  normally first. Review Relay never runs project install scripts for you.

VERIFICATION

Built for Linux x86_64 from the current app source. Production compilation,
focused terminal/question tests, installation/update/removal fixtures and
packaged-code integrity are checked on macOS. This release has not been
launched on an actual Omarchy/Hyprland desktop; that runtime check remains.
The Linux test container could not be downloaded in the build environment.

Source and third-party licenses are included with the release/source tree.
Electron and Chromium licenses are in app/. Review Relay's license and
third-party notices are alongside this file and within app/resources/app.asar.

PROJECT INVITATIONS

The installer registers reviewrelay-room links. Open your colleague's HTTPS
invitation and choose Open Review Relay. Sign into your own Gitea account,
then choose Join and open PR. Hosting access is not required to join.
The experimental app installs alongside the stable version.
