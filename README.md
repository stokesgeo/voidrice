# vertrice

vertrice is [voidrice](https://github.com/LukeSmithxyz/voidrice), Luke
Smith's dotfiles, ported to OpenBSD and set up for a ThinkPad X220. It keeps
voidrice's organization: scripts in `~/.local/bin`, config in `~/.config`,
bookmarks compiled to shell shortcuts, dmenu for every menu, one status line.
It runs on OpenBSD's base system: ksh for the shell, cwm with voidrice's dwm
keys for the window manager, xterm for the terminal. Luke's dwm and st are
opt-ins.

Target: OpenBSD 8.0 when it is released; until then -current (snapshots).
See "Release target" in [OPENBSD.md](OPENBSD.md). It has been tested off the
machine against mocked OpenBSD commands, not yet on an X220.

## Base first

Use what OpenBSD ships. A package is added only for a feature we want that
base does not provide, and the reason is written down. The package lists
are in `~/.local/share/openbsd`: `pkglist` is the core that the default
session and its keys need; `pkglist.extra` holds features you can skip
(mail, news, torrents, web video and others).

## Install

On a fresh OpenBSD install, as root: `pkg_add git`. Then, as your user:

    git clone --bare https://github.com/stokesgeo/vertrice.git ~/.local/share/vertrice.git
    git --git-dir=$HOME/.local/share/vertrice.git show HEAD:.local/bin/vertrice-install >/tmp/vertrice-install
    ksh /tmp/vertrice-install -y home
    doas ~/.local/bin/vertrice-install -y system    # first time: su -, then the full path

Add `-e` to the system stage to install `pkglist.extra` too. Without `-y`,
each stage prints its plan and changes nothing. The full steps, and what
each one does, are in [OPENBSD.md](OPENBSD.md), "Installing on the X220".

## Documentation

- [OPENBSD.md](OPENBSD.md): what changed from voidrice and why, the
  dwm-to-cwm key table, X220 details, the install, the packages, and what
  is not ported.
- `~/.local/share/vertrice/CHANGES`: the changes relative to voidrice,
  grouped.
- Super+F1 lists the window manager's keys, read from
  `~/.config/cwm/cwmrc`.
- `~/.local/share/openbsd/check` tests on the machine what could not be
  tested off it; `~/.local/share/vertrice/tests/run` is the regression
  suite.

## Credits

vertrice is built on voidrice by [Luke Smith](https://lukesmith.xyz) and
voidrice's contributors; most of the scripts and configs are theirs. The
license is unchanged: GNU GPL version 3 (see [LICENSE](LICENSE)).

Default desktop artwork: Thomas Thiemeyer, *The Road to Samarkand*.
