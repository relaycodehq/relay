---
name: release
description: Ship a Relay release to friends - draft user-facing release notes from what landed on main since the last v* tag, get them approved, then tag and push. Use when the user asks to release, ship, cut or tag a version, or to write the changelog.
---

# Releasing Relay

Pushing to main ships nothing. A release is an annotated `vX.Y.Z` tag on a
commit on main; its message is the changelog shown in Settings → About and on
the GitHub release. The Mac mini polls for new tags and builds them
(`scripts/mini-ci/`), taking about 10 minutes, longer when the APK rebuilds.

1. `scripts/tag-release.sh log` lists the commits on origin/main since the last
   tag. Commits only on local main aren't in it: they need pushing first, which
   the user has to ask for.
2. Draft the notes in a temp file, for the people using the app:
   - Bullets, most noticeable first, each saying what a user can now do or no
     longer runs into. Use the app's own names for things (Settings → About, the
     review, the phone app), not file or function names.
   - Merge commits that are one change; leave out tests, previews, refactors,
     CI and release plumbing, agent guidance, and anything else nobody using
     the app would notice.
   - An optional first line summing up a big release, then a blank line. No `#`
     headings.
   - Plain and short, in the voice of the commit subjects.
3. Show the user the draft and the version (next patch unless they say otherwise;
   a minor bump for a big release). Tag only once they approve the notes.
4. `scripts/tag-release.sh <notes file> [version]` tags origin/main and pushes
   the tag. The build reports as the `Release` status on the tagged commit.

Fix a typo in a published release with `gh release edit vX.Y.Z --repo
lubomirmolin/relay-releases --notes-file …`. A published version is never
rebuilt; when a build fails, fix it on main and tag the next version.
