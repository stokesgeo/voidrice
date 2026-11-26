# After installation

Use this guide to begin useful work on an existing OpenBSD system. It is not
an acceptance log or proof that setup succeeded. Keep private account details
and any troubleshooting notes locally, outside the public source tree. Pi and
Crush are both required supported assistants; optional applications are chosen
workflows. First-only assistant installation uses `vertrice-pi-setup` and
`vertrice-crush-setup`, both as the ordinary user. Existing installations are
retained, not overwritten.

## First login and recovery

Retain setup's recovery copies before merging local settings. Manual forced
checkout does not create those copies. Do not repeat setup or force checkout
to repair an unexplained failure. The system installer replaces system policy
and service settings and has no automatic rollback.

Reboot when ready, then check the intended fresh login, X session, cwm,
terminal, fonts, notifications and status line. Existing shells do not prove
that new profile variables reached the desktop. Review the user's login class
and resource limits; installing the staff class file does not assign the class
to an existing account.

Connect Wi-Fi with Super+Shift+w or use Ethernet. Check address, route, DNS
and a known HTTPS page, not just the network icon. Confirm the clock and free
space. Review doas locally; never give a password to an assistant conversation.
Keep firewall policy intact rather than opening inbound SSH for convenience.

The required ClamAV package, `/etc/clamav-certs` certificate and current readable
signature database must be present. System provisioning runs the initial
foreground refresh and schedules daily refreshes. A missing/stale database or
failed scan is a prerequisite failure, not an optional feature to disable.

## Learn the desktop on this machine

Super+F1 shows actual bindings. Practice a terminal, application menu, file
manager, window switching and workspaces. Super+a opens Pi; `crush` runs Crush
in a terminal. Super+w opens qutebrowser; Super+Shift+w is wireless selection,
not an agent-browser binding. Chromium remains available as `chrome`.

Check keyboard/TrackPoint behavior, brightness, display selection, audio and
battery readings against native interfaces. Check locking locally: display-off
is not locking. Save work before trying suspend/resume; check the locked state
and recovery of network, audio and input on wake. Keep microphone and camera
off except during a deliberate test or call. X210AI hardware has not yet been
tested; repeat physical checks on each machine rather than assuming parity.

## Local assistant sign-in

Once both supported applications are installed, start each from the intended
working directory. Choose a provider/model and complete sign-in locally in the
application. Never copy another account's credentials or sign-in state from
source or transfer media. Pi's first-only profile uses generic settings and an
empty private auth object, not seeded credentials; application generations and
profile state have separate locations. Preserve existing profiles.

Try a harmless synthetic request, inspect the selected provider/model, and
resume a disposable session. Check questions, cancellations and native
permission prompts before using private work. Crush's default read grants are
`view`, `ls`, `glob` and `grep`; commands and changes still need native approvals.
Administrator approval and subagent roles do not create OS isolation.
Optional LSP servers and remote services are not configured automatically.
See [capabilities and boundaries](PI_CAPABILITIES.md).

## Writing and files

Try a disposable text file, directory, PDF, image and media file through normal
open/preview paths. In ordinary Neovim, check editing, undo, explicit save and
reopening. Review first-use plugin downloads before allowing execution.
Compilers and build tools can execute project code; TeX cleanup is explicit,
not an editor-exit action.

For live writing, run `ipe-pi FILE` from the intended work root. `,pp` toggles the
retained Pi pane. Pi reads unsaved text through `ipe_editor`; a requested edit
must respect the buffer revision and does not imply a disk save. Undo and save
explicitly, then reopen the disposable file. See `~/.config/ipe-pi/README.md`
for transport, backup and recovery limitations. Snapshots do not replace
filesystem backups.

Try a disposable `work_task` if useful. Its default local store is
`~/.local/share/vertrice-work`; it does not synchronize to another device.
Packaged context search covers its explicit manifest, not a personal corpus.

## Choose additional workflows

Use `.local/share/openbsd/pkglist.extra` to identify optional packages, not as
a request to install them all. Configure each chosen application's data and
account locally.

- **Mail and contacts:** configure accounts locally in the chosen mail application. Keep passwords, tokens and correspondence out of assistant
  sessions. Test receiving and folder behavior; send only deliberately to an
  agreed recipient, never as an automatic smoke test. Use a synthetic HTML
  message to check text rendering.
- **Newsboat and downloads:** choose feeds and destinations; check read-state
  persistence and comma-w terminal browsing. Review scheduled refresh and
  download actions before enabling them. No transcript-ingestion service is
  configured by default.
- **Music:** point user MPD/ncmpcpp at the wanted library and playlists. Check
  sndio playback and the loopback-only listener; avoid a conflicting system MPD.
- **Dictionary:** after installing the optional packages, review and run
  `doas sh ~/.local/bin/vertrice-dict`; keep the dictionary server local-only.
- **Reminders:** add entries to `~/.calendar/calendar` and check local mail
  delivery. User cron and feed refresh need their own configuration; the root
  updater does not establish those workflows.
- **Other applications:** chat, passwords/OTP, torrents, office, artwork,
  TeX/OCR and recording each need their own package, data and practical check.

## Backups and maintenance

`bk` dumps `/home` to a mounted backup disk. Confirm the source and destination
before copying anything. Dumps may contain credentials and are not automatically
encrypted. Try restoring to a separate disposable target; never format a disk
or overwrite an existing backup by assumption.

Use [source and system updates](SOURCE-UPDATES.md) to distinguish fresh install,
source review, adoption and routine maintenance. Do not confuse the bare HOME
repository with the source checkout. Root/service template changes need review;
a source update does not mean services were reconfigured or restarted.

Finish a small daily-use loop: open work, use an editor or assistant, explicitly
save, find it again and resume. An installed package, running process or passing
repository test alone does not establish that loop or hardware compatibility.
