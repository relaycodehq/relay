# Security policy

## Report a vulnerability privately

Email [hello@relaycode.io](mailto:hello@relaycode.io) with a subject beginning
`[SECURITY] Relay`.

**Do not post vulnerability details in a public issue, discussion or pull
request.** GitHub private vulnerability reporting is not currently enabled for
this repository; email is the reporting route.

Include what you have:

- The affected Relay version or commit, OS, and component (desktop, phone or
  headless). For agent issues, include the agent version and permission mode.
- The impact and prerequisites: for example, local access, tailnet access, a
  paired device or an untrusted project.
- Minimal reproduction steps or a proof of concept using disposable data, plus
  expected and actual behavior.
- Relevant redacted logs or screenshots, and any suggested fix.

An incomplete report is welcome. Do not send live credentials, pairing codes,
device tokens, private keys, private source or full Relay data folders. A short
sanitized reproduction is more useful. If sensitive material is essential, ask
how to transfer it before sending it; ordinary email is not end-to-end encrypted.

Maintainers will triage the report, ask for details as needed, and coordinate a
fix and disclosure with you. Response and fix times are best effort, with no
guaranteed deadline. If you have not heard back after a week, follow up on the
same email thread. Please coordinate publication of exploit details so users
have a chance to update; reporter credit can be included with your consent.

## Supported versions

Security fixes target the
[latest published release](https://github.com/relaycodehq/relay/releases/latest)
and the `main` branch. Older releases do not have a maintained security backport
line. Please report findings from older versions too, noting whether they also
reproduce on the latest release. Include the phone app version separately when
applicable.

## Security boundaries

Relay runs coding agents as your operating-system user. Agents can read files,
edit projects, run shell commands and access the network according to their
provider's capabilities and selected permission mode. **Full access allows
commands and edits without approval prompts.** Relay is not a security sandbox
for untrusted projects or agents; a project folder is not a universal filesystem
access boundary. Permission behavior varies by agent.

A paired phone can read project and conversation data, perform allowed Git
actions and start agent turns on the connected computer. Treat pairing codes,
links and paired devices as access to that computer's Relay workspace. Keep them
private and revoke devices you no longer trust. See [phone pairing](docs/phone.md)
and [headless operation](docs/headless.md).

The remote connection uses Tailscale plus Relay's own Noise NK-style protocol in
`shared/remote-crypto.ts`, built with X25519, HKDF-SHA-256 and
ChaCha20-Poly1305 from the noble libraries. The handshake and framing are Relay
code; using standard cryptographic primitives does not by itself validate the
protocol's security. Pairing, key pinning, token verification, replay protection
and remote method authorization are all relevant to vulnerability reports.

Chat history and project paths are stored locally without encryption at rest.
Desktop secrets use OS credential storage where available; headless Relay uses
a local key file protected by filesystem permissions. This does not protect
against a compromised OS account or an attacker who can read both encrypted
secrets and the headless key file. Agents send data to their own providers under
those providers' policies.

Examples of issues to report privately include:

- Relay bypassing a selected permission or approval policy, or treating
  untrusted project/chat content as authority to perform privileged actions.
- Unauthorized access through Electron IPC, the local tools server, rendered
  content, remote calls or file paths.
- Pairing/authentication bypass, broken key pinning, encryption flaws, accepted
  replayed frames or continued access after device revocation.
- Unintended exposure of credentials, private keys, device tokens or private
  project/conversation data.
- Update signature or integrity-check bypasses, or exploitable dependencies in
  Relay's shipped execution paths.

An action explicitly permitted by Full access is expected behavior; a way to
gain that access without authorization is a security issue. If you are unsure,
report privately and let maintainers assess it. Test only systems, accounts and
data you own or have permission to test, using disposable projects and devices.
