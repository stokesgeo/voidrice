# vertrice

[voidrice](https://github.com/LukeSmithxyz/voidrice) ported to OpenBSD for
ThinkPads X220 and X210AI: ksh, cwm, xterm, dmenu and a small shell-script
desktop. Base system first; packages supply what base does not.

The same repository also supports Apple-silicon Macs with Ghostty, AeroSpace
and SketchyBar. Each system checks out only its selected files.

## Install on OpenBSD

Vertrice configures an existing OpenBSD installation. It is not an OS or
firmware installer. Package and Pi installation need network access.

For a prepared setup USB, read its `README.txt` and start `SETUP` with base
`sh` as the normal user. Use local root authentication when requested. The USB
checks its payload, stages it on the native filesystem and asks before system
changes and home-file replacement. Keep the reported backup/staging paths.

For a manual install into a fresh home, first install Git as root:

    pkg_add git

Then, as the normal user:

    git clone --bare https://github.com/stokesgeo/voidrice.git ~/.local/share/vertrice.git
    cd ~/.local/share/vertrice.git
    git show HEAD:.local/share/$(uname | tr A-Z a-z)/sparse-checkout | git --work-tree=$HOME sparse-checkout set --no-cone --stdin
    git --work-tree=$HOME checkout -f
    git config status.showUntrackedFiles no

**A forced checkout replaces selected files.** For an existing home, preserve
and merge local configuration first. The manual procedure above does not make
the setup USB's recovery copies.

Read `~/.local/bin/vertrice-install`, then run it as root. With configured doas:

    doas sh ~/.local/bin/vertrice-install

Otherwise use `su` and the script's absolute path. Return to the normal user
before installing Pi:

    sh ~/.local/bin/openbsd/vertrice-pi-setup

The installer checks doas/pf syntax and stops on failure. Earlier package,
service and configuration changes can remain; there is no automatic rollback.
Run setup locally: installing its firewall can interrupt existing inbound SSH.

Review local settings, then reboot when ready. Use a separate working copy of
[POST-INSTALL.md](.local/share/vertrice/POST-INSTALL.md) per machine. It covers
fresh login, hardware, private account sign-in, daily use and recovery.

## Daily use

The default OpenBSD wallpaper is a hotkey and workflow guide. It fits without
cropping on different screen shapes. A saved `~/.local/share/bg` choice takes
precedence; `setbg ~/.local/share/vertrice/KEYS.png` selects the guide explicitly.
The guide reflects the shipped cwm keys; Super+F1 reads your current bindings.

- Super+F1: keys; Super+a: Pi; `ipe-pi FILE`: live writing seat.
- Super+w: qutebrowser for the human; Super+Shift+w: Chromium for agents.
- W3m: terminal browser and HTML text rendering. `TERMINAL_BROWSER` selects
  w3m, lynx or elinks; install the selected package and start a fresh login.
- `man vertrice`: desktop, administration, writing, media and backups.
- [OPENBSD.md](.local/share/vertrice/OPENBSD.md): purpose and operating principles.
- [Pi capabilities](.local/share/vertrice/PI_CAPABILITIES.md): local tools and
  unavailable remote services.

Optional packages are listed in `.local/share/openbsd/pkglist.extra`. Choose
the workflows you want; applications still need their data and account setup.
Dictionary setup uses `vertrice-dict` after its optional packages are present.
Language compilers need their own toolchains. TeX build/cleanup is explicit,
not an action performed when closing an editor.

Pi is the default assistant. Its user setup installs locked Pi 1.5.0 with npm
lifecycle scripts disabled and preserves existing settings. Sign in locally;
no provider credentials belong on the setup USB. The launcher does not install
software on startup. Codex is deprecated and absent from the OpenBSD package
lists; retained cdxb code is not required for Pi. Updating a list does not
uninstall an existing package.

Pi runs with normal user access. Admin approval and separate subagent contexts
are not OS sandboxes. No remote ingestion, device-delivery or task-sync
service is installed. Read the IPE README for explicit save and recovery rules.

## Updates

`config` is Git pointed at the bare repository with HOME as its work tree.
Inspect local changes and the configured remote before pulling with
`config pull origin master`. Preserve owner settings and review selected-file
replacements. Changes under `.local/share/openbsd` may require the system
installer; sparse-selection changes require reapplying the selection before
checkout. Do not rerun setup blindly to repair an unexplained failure.

## macOS

Review and merge selected files before checkout on an existing Mac. Run the
installer as your user, not root; `--keep-shell` retains your login shell.
See the manual's Mac section for desktop permissions and keys. Existing sleep
and password-delay settings are preserved; display-off does not promise locking.

## Development

Tests and qualification records are not installed desktop requirements.
Run `.local/share/vertrice/tests/run` from a repository checkout. Developer
hardware checks need review and an explicitly chosen target; they are not part
of normal first boot.

The repository contains public code, general defaults and tests. Personal
profiles, task records, account settings and private development notes are not
release material. Review the staged tree and run a redacted secret scan before
publication; deleting a file at the tip does not remove it from Git history.

## Credits

Built on voidrice by Luke Smith and its contributors. GNU GPL version 3;
see [LICENSE](LICENSE). Retained artwork and Mac default: Thomas Thiemeyer,
*The Road to Samarkand*. The OpenBSD default is the Vertrice key guide.
