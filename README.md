# vertrice

[voidrice](https://github.com/LukeSmithxyz/voidrice) adapted to OpenBSD:
ksh, cwm, xterm, dmenu and small scripts for writing, browsing, mail, media
and system maintenance. Pi and Crush are both required supported assistants;
account sign-in stays local. Base system first; packages supply what base lacks.

The OpenBSD target includes ThinkPads X220 and X210AI. X210AI hardware has not
yet been tested; installation does not establish hardware compatibility.
The same repository supports Apple-silicon Macs with Ghostty, AeroSpace and
SketchyBar. Each system selects its own files.

## Install on OpenBSD

Vertrice configures an existing OpenBSD installation; it does not install the
OS or firmware. Review the scripts before running them. Use a local console:
the system installer replaces configuration and firewall rules, can interrupt
inbound SSH, and does not roll back earlier changes after a failure.

For a prepared setup USB, follow its `README.txt` and run `SETUP` with base
`sh` as the normal user. Authenticate locally when asked and retain its recovery
copies. Do not put credentials or personal profiles on transfer media.

For a manual fresh-home checkout, install Git as root:

    pkg_add git

Then, as the normal user:

    git clone --bare https://github.com/stokesgeo/voidrice.git ~/.local/share/vertrice.git
    cd ~/.local/share/vertrice.git
    git show HEAD:.local/share/$(uname | tr A-Z a-z)/sparse-checkout | git --work-tree=$HOME sparse-checkout set --no-cone --stdin
    git --work-tree=$HOME checkout -f
    git config status.showUntrackedFiles no

**Forced checkout replaces selected files.** Preserve and merge local files
first on an existing account. This manual route does not make USB recovery copies
or adopt the source-update layout.

Read `~/.local/bin/vertrice-install`, then run it as root. With configured doas:

    doas sh ~/.local/bin/vertrice-install

Otherwise use `su` and the script's absolute path. The installer installs the
required scanner, certificate and signature database, runs the initial
foreground signature refresh, and schedules daily refreshes. A missing or stale
database is a failed prerequisite, not permission to skip scanning.

Return to the ordinary user for first-only assistant setup:

    vertrice-pi-setup

Pi setup acquires the pinned public inputs, builds the application and initializes
a credential-free local profile. It retains an existing installation rather than
migrating or overwriting it. Then install Crush:

    vertrice-crush-setup

It acquires pinned public source, compiler and modules, builds without root,
and installs a private generation. Existing activation is retained, not replaced.
The `crush` launcher validates that private generation and fails closed rather
than using a system fallback. Provider sign-in remains local under native
HOME/XDG paths. See the [source-build guide](.local/share/openbsd/crush/README.md)
for inputs, network use, offline builds and component license notices.

A build output alone is not an installation. Check both assistants locally,
including provider sign-in and a harmless request. Software checks do not establish
hardware compatibility or successful account access.

Review local settings and reboot when ready. See
[post-install use](.local/share/vertrice/POST-INSTALL.md) for fresh login,
local sign-in and practical checks.

## Daily use

- Super+F1 lists current keys; Super+a opens Pi; run `crush` in a terminal for Crush.
- Super+w opens qutebrowser; Super+Shift+w joins Wi-Fi with `dmenuwifi`.
  Chromium remains available as `chrome`, not on that wireless shortcut.
- `ipe-pi FILE` opens a live writing seat; edits and explicit save are separate.
- W3m is the terminal browser and HTML renderer. `TERMINAL_BROWSER` in
  `~/.config/shell/profile` can select w3m, lynx or elinks; install the matching
  package and start a fresh login.
- `man vertrice` covers desktop keys, writing, dictionary, media and backups.
- [OPENBSD.md](.local/share/vertrice/OPENBSD.md) explains the desktop defaults.
- [Assistant capabilities](.local/share/vertrice/PI_CAPABILITIES.md) describes
  supplied tools and configuration boundaries.
- To keep tasks and notes that outlast one assistant session, try the
  [shared agent home](.local/share/vertrice-agents/README.md#try-it-on-a-scratch-home)
  on a scratch directory first.

The default OpenBSD wallpaper is the key guide. A saved wallpaper takes
precedence; `setbg ~/.local/share/vertrice/KEYS.png` selects the guide explicitly.
Optional applications are in `.local/share/openbsd/pkglist.extra`; select only
wanted workflows, then configure their data and accounts locally. Compiler and
TeX workflows need their own toolchains and explicitly execute build commands.

## Updates

See [source and system updates](.local/share/vertrice/SOURCE-UPDATES.md).
Fresh installation, adoption of an existing HOME, source review and routine
maintenance are separate operations. Do not rerun the installer or force a
checkout to repair an unexplained update failure.

## macOS

Review and merge selected files before checkout on an existing Mac. Run the
installer as your user, not root; `--keep-shell` retains your login shell.
See the manual's Mac section for desktop permissions and keys. Existing sleep
and password-delay settings are preserved; display-off does not promise locking.

## Development

The [shared agent home](.local/share/vertrice-agents/README.md) adds
`vertrice-agents`, starter files that `vertrice-agents init` copies in, and Pi
bindings for shared tasks, sessions and optional owner instructions. New Pi
builds use those bindings by default; existing owner files are never replaced.

Run `.local/share/vertrice/tests/run` from a repository checkout. Tests are not
first-login tasks and do not establish hardware compatibility. The public tree
contains code, generic defaults and tests, not private profiles, credentials,
task records or development notes. Review publication content and Git history
for secrets; removing a file at the tip does not remove earlier copies.

## Credits

Built on voidrice by Luke Smith and its contributors. Repository scripts are
licensed under GNU GPL version 3; see [LICENSE](LICENSE). Separately licensed
third-party components retain their own licenses and notices; consult each
component's license for its terms, including redistribution. The native Crush
source uses FSL-1.1-MIT, not a blanket MIT license; bundled vimbubble notices
retain their MIT terms.

Retained artwork and Mac default: Thomas Thiemeyer, *The Road to Samarkand*.
The OpenBSD default is the Vertrice key guide.
