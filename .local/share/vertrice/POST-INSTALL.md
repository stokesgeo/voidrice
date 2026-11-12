# Vertrice after install — user + Pi

A working checklist for an existing OpenBSD system after Vertrice setup.
Nothing is checked by default. Installed packages are not proof of a working
workflow. Use a separate working copy for each machine.
Keep this repository template unmarked.

**Record:** date: ___; machine: X220 / X210AI / other: ___; OpenBSD release and
architecture: ___; installed Vertrice commit: ___; working-copy path: ___;
configuration/recovery backup paths: ___; next sitting: ___.

**Owners:** **Pi** = inspect/test and report; **User** = physical use or private
account UI; **Both** = Pi supplies evidence and the user checks the experience.
For each item record **pass / fail / deferred / not applicable**, evidence and
the next action. A tick means the stated outcome was observed, not just tried.
Keep an open item with an owner when it is not finished. Optional sections are
chosen workflows, not a request to install every package or connect every account.

## How Pi should work this list

- Start with safe inspection. State what cannot be checked remotely or outside X.
- Surface configuration changes and their effects before making them. Use the
  existing owner-approval/admin path for root operations, not a password tool.
- Never request or print passwords, tokens, private keys, auth files or cookies.
  The user signs in at the application's local UI. Inspect metadata or redacted
  status, not credentials. Do not send private test material to a model provider.
- Use disposable notes/media/tasks for tests. Preserve existing settings and
  backups. Do not repeat forced checkout or setup to repair an unexplained fault.
- Do not open a live file through disk tools while IPE owns its unsaved buffer.
- Read the local manual and relevant config before assuming a default. An old
  owner setting may intentionally differ from the template.

## 1. Installation and recovery boundary

- [ ] **Pi:** identify the actual OS, machine, normal user, installed revision
  and repository location. Record version/hash evidence, not only a folder name.
- [ ] **Both:** confirm the existing OS/firmware and wanted personal files
  remain present. No clean reinstall, disk formatting or credential copy is
  part of this checklist.
- [ ] **Pi:** locate setup's retained user stage, home replacements, previous
  repository, Pi application archive and root-only configuration backup. Record
  paths and permissions; do not read secret-bearing archives into the session.
- [ ] **Both:** identify local configuration that needs merging from those
  backups. Setup replaces selected files; it does not perform a semantic merge
  or automatic rollback. Keep recovery copies until the user is satisfied.
- [ ] **Pi:** separate the base environment, selected optional workflows and
  deferred work in the existing plaintext task store. Do not mark the whole
  machine complete while selected required items are still open.

## 2. Base system, network and fresh login

- [ ] **Pi:** check release/patch state, clock/timezone, free space and package
  state. Present needed updates separately; do not upgrade the OS as a side
  effect of a status check. Confirm the installed w3m package, not the literal
  `w3m--` package-selector spelling as an installed version name.
- [ ] **Both:** connect the wanted Wi-Fi/Ethernet connection. Check association,
  address, route, DNS and a known HTTPS page. A network icon alone is not proof
  of internet access. Test reconnection after a normal reboot.
- [ ] **Pi:** check the normal user's wheel membership and actual login class/
  resource limits. Installing the staff class file does not assign that class
  to an existing account. Review any account change before applying it.
- [ ] **Both:** finish a fresh login/reboot and check the intended X session,
  cwm, terminal, fonts, notification service and status line. Do not infer fresh
  environment variables from an already-running shell.
- [ ] **Pi:** check relevant base/package services: sndiod, apmd, hotplugd,
  unwind, messagebus and obsdfreqd. Distinguish enabled-at-boot from running.
- [ ] **Both:** verify authenticated doas behavior locally. No unexpected
  passwordless rule or authentication persistence. No password enters Pi's
  transcript. Denial/cancellation before execution must prevent launch;
  interruption after launch needs an outcome check because effects may remain.
- [ ] **Pi:** review the loaded firewall against intended access. The shipped
  policy blocks new inbound SSH. Do not open SSH or disable the firewall merely
  to make a remote checklist session convenient.

## 3. Learn and check the desktop

- [ ] **User:** use Super+F1 to find the actual key map. Practice terminal,
  application menu, file manager, window switching, tiling and workspaces.
- [ ] **Both:** check keyboard/remaps, TrackPoint scrolling, intended touchpad
  state, DPI, external display selection and brightness on this machine.
- [ ] **Both:** check day/night palette, status readings and notifications.
  Confirm meaningful battery/temperature/audio/network readings against native
  interfaces; a nonempty status string is not enough.
- [ ] **User:** lock through the system menu, then confirm a password is needed
  to regain the session. Display-off is not locking.
- [ ] **User:** after saving work, test suspend/resume and the locked state on
  wake; check network/audio/input recovery. Test hibernate only if wanted and
  supported. The suspend hook's signal plus pause is not a lock acknowledgment.
- [ ] **Both:** check the intended microphone/camera recording state. Turn them
  on only for a chosen test/call, then confirm they return to the wanted state.
- [ ] **Both:** repeat physical checks on each machine. A shared software
  configuration does not establish that different hardware behaves the same.

## 4. Files, browsers and ordinary writing

- [ ] **Both:** open a disposable text, directory, PDF, image and media file
  through the intended desktop/file-manager paths. Check opening, preview and
  return to the caller; a supported format on paper is not a successful test.
- [ ] **Both:** test the chosen human browser, qutebrowser by default, on a
  known page. Check rendering and input; do not disable TLS checks or its
  sandbox to force a pass.
- [ ] **Both:** check Chromium separately for intended agent-browser use.
  Launching it does not establish a private browser-worker sandbox or authorize
  access to the user's personal signed-in browser sessions.
- [ ] **Both:** check the terminal-browser choice in the fresh-login profile;
  w3m is the shipped default. Test an actual page and local HTML conversion.
  Changing to Lynx/ELinks also needs the matching installed package.
- [ ] **Both:** try a disposable note in ordinary Neovim: editing, undo, explicit
  save and reopening preserve wanted whitespace and content. TeX exit does not
  run cleanup. Compilers/build tools can execute project code; choose them explicitly.
- [ ] **Both:** review ordinary Neovim's first-use vim-plug/plugin bootstrap
  before allowing downloads or plugin execution. Those moving upstream plugins
  are not covered by the setup USB's pinned source/npm lock.
- [ ] **User:** try the full-screen writing entry and chosen writing directory.
  Check comfort and expected keys; log friction rather than redesigning the
  desktop before real use shows what is wrong.

## 5. Pi as the default assistant

- [ ] **Pi:** confirm the native Pi launcher, installed 1.5.0 runtime, Node and
  fd are available; no startup download or extension-load error. Existing owner
  settings are preserved, not replaced merely to match a default screenshot.
- [ ] **User:** choose provider/model and sign in locally. Keep account state
  on the laptop; do not put credentials on the transfer stick or in chat.
- [ ] **Both:** start Pi with Super+a. Send a harmless synthetic request, check
  the actual provider/model and usable terminal input, and resume a test session.
  Confirm sign-in and a real response from the chosen provider.
- [ ] **Both:** exercise an owner question, a different written answer and a
  cancellation. If testing admin handoff, use a harmless agreed operation;
  verify the visible request and resulting state, not only exit status.
- [ ] **Pi:** create/read/update a disposable `work_task`; check its on-disk
  record, revision checks, owner/next action and visible widget. Default store
  is `~/.local/share/vertrice-work`; inspect `VERTRICE_WORK_DIR` if configured.
- [ ] **Pi:** exercise `context_search` and `context_read` against the packaged
  context. Check returned path/hash evidence. This is not the full personal
  corpus, qmd, web access or an established Mac/hub connection.
- [ ] **Both:** try a bounded synthetic delegation and cancellation if useful.
  Worker/scout/reviewer and tool-free reader roles do not create OS compartments.
- [ ] **Both:** confirm general Pi is understood to be unconfined. Review any
  installed extension/MCP authority before exposing private or external material.
  No remote ingestion service is configured by setup. Do not silently add a
  service or install a generic filesystem bridge.

## 6. Live writing with Pi

- [ ] **Both:** open a disposable file through the dedicated `ipe-pi` seat,
  from the intended work root. Confirm the retained Pi pane toggles with `,pp`.
- [ ] **Pi:** use `ipe_editor` to read unsaved text, selection and revision.
  Agree a small test change; verify it appears in the live buffer without an
  implicit disk save. A stale revision must not silently overwrite newer work.
- [ ] **User:** check undo and explicitly save; reopen the disposable file and
  compare. Ordinary Neovim and the IPE seat remain separate.
- [ ] **Both:** inspect a disposable backup/snapshot and deliberately recover
  it to another test file. Snapshots normalize LF/final newline; they are not
  byte-exact recovery for every encoding. Preserve legacy backups. See
  `~/.config/ipe-pi/README.md` for transport, locking and recovery limits.
- [ ] **User:** complete a small useful writing sitting. Author permission,
  selection and explicit save remain separate from opening a seat.

## 7. Selected optional workflows

Mark each subsection wanted, deferred or not applicable before setup. Do not
install the entire optional list merely to obtain one application.

### Mail and contacts

- [ ] **Both:** choose the intended mail/contacts workflow and required optional
  packages. Inventory existing setup without displaying account secrets or
  reading private correspondence into a model session.
- [ ] **User:** complete account sign-in/setup locally. Check incoming mail,
  folder behavior and a deliberate test to an agreed recipient if sending is
  wanted. Never send a message as an automatic smoke test.
- [ ] **Both:** check HTML text rendering with a synthetic message, the normal
  HTML opener and native mailcap sanitization. Account success does not establish
  a confined email agent; that specialist remains future work.

### Newsboat, downloads and transcripts

- [ ] **Both:** choose wanted feeds and install only needed optional tools.
  Test a public/synthetic feed, read-state persistence, U URL selection and the
  comma-w terminal-browser path. Review scheduled refresh before enabling it.
- [ ] **Both:** choose download destinations and test one wanted download/queue
  action. The inherited youtube-viewer comments action has no verified native
  provider; do not call it working merely because other YouTube actions work.
- [ ] **Both:** identify the actual transcript-feed source, storage and reader.
  There is no installed production airlock/transcript pipeline here. If wanted,
  keep it open with an owner rather than inventing an endpoint or trusting raw
  external text as instructions. A tool-free reader is not complete isolation.

### Music, dictionary, reminders and other apps

- [ ] **Both:** point user MPD/ncmpcpp at the wanted music directory and
  playlists. Check the user process, loopback-only listener, library, sndio
  playback and volume. Avoid enabling a second conflicting system MPD.
- [ ] **Both:** if wanted, prepare the optional local dictionary/Roget data
  after reviewing the root operation and network fetch. Check lookups and the
  editor's word-lookup action; keep the dictionary server local-only.
- [ ] **Both:** if wanted, add a disposable calendar reminder and verify actual
  local mail delivery. The root update-count job is not proof that the user's
  reminders, user cron or feed refresh have been configured.
- [ ] **Pi:** before chosen user cron jobs, verify the fresh X/D-Bus session
  environment and preserve existing crontab entries. See `.local/bin/cron/README.md`.
- [ ] **Both:** record selected chat, password-store/OTP, torrent, office,
  artwork, TeX/OCR or recording workflows separately. Each needs its own
  package/account/data and end-to-end check; none is implicitly selected here.

## 8. Backup, updates and handoff

- [ ] **Both:** identify the backup device and wanted protection before copying
  real data. `bk` dumps /home to a mounted backup disk; dumps may contain
  credentials and are not automatically encrypted. Confirm source/destination
  identity. Never format a disk or back up onto the test SSD by assumption.
- [ ] **Both:** verify one chosen backup through a separate disposable restore
  target. Preserve failed/unfinished attempts and existing backups. IPE
  snapshots do not replace filesystem backups.
- [ ] **Pi:** inspect root's update-count schedule without exposing unrelated
  private cron content. Check package/base update reporting; an update count is
  not an installed update or a verified reboot.
- [ ] **Both:** establish the intended source-update/return path. The installed
  source revision is recorded by SETUP. Record the installed revision and
  inspect the remote and branch before pulling. No remote Git return service
  or cross-device task synchronization is established by installation.
- [ ] **Pi:** verify selected workflows through their real user paths. A
  running process, installed package or nonempty status is not proof of useful
  behavior. Keep developer regression scripts out of the normal first-boot flow.
- [ ] **Both:** finish a small daily-use loop: open work, use the chosen editor/
  Pi seat, save, find it again and resume. Record what was genuinely useful and
  what failed, with separate notes for each ThinkPad.
- [ ] **Pi:** summarize verified outcomes, chosen optional items, open faults
  and next owners. Keep evidence local and free of credentials/private content.
  cdxb is deprecated and is not needed to accept Pi as the default assistant.

## Not installed by setup

Remote ingestion, device delivery and cross-device synchronization need
separate configuration. Do not invent services or account permissions to mark
this checklist complete.

References: installed vertrice manual; `.local/share/vertrice/OPENBSD.md`;
`.local/share/vertrice/PI_CAPABILITIES.md`; `.config/ipe-pi/README.md`;
`.local/share/openbsd/pkglist` and `pkglist.extra`; relevant actual config files.
