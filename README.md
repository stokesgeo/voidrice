# vertrice

vertrice is [voidrice](https://github.com/LukeSmithxyz/voidrice), Luke
Smith's dotfiles, ported to OpenBSD and set up for a ThinkPad X220. It keeps
voidrice's layout: scripts in `~/.local/bin`, configuration in `~/.config`,
dmenu for every menu, one status line. It uses the base system first: ksh,
cwm with voidrice's keys, and xterm. A package is added only for a feature
base does not have.

It tracks the latest OpenBSD release or -current. It has been tested
against mocked OpenBSD commands, not yet on an X220.

## Install

As root on a fresh system:

    pkg_add git

As your user:

    git clone --bare https://github.com/stokesgeo/vertrice.git ~/.local/share/vertrice.git
    git --git-dir=$HOME/.local/share/vertrice.git --work-tree=$HOME checkout -f
    git --git-dir=$HOME/.local/share/vertrice.git config status.showUntrackedFiles no

Then read `~/.local/bin/vertrice-install`, the system half, and run it as
root. The first time there is no doas rule yet: `su -`, then
`sh /home/YOU/.local/bin/vertrice-install`. Later:

    doas sh ~/.local/bin/vertrice-install

Reboot. Optional packages (mail, news, torrents, the dictionary and others),
then the dictionary:

    doas pkg_add -l ~/.local/share/openbsd/pkglist.extra
    doas sh ~/.local/bin/vertrice-dict

Update with `config pull origin master`. After an update that changes
`~/.local/share/openbsd`, run the installer again.

## Documentation

`man vertrice` is the reference: the install and what the installer
changes in `/etc`, the session, the keys, the machine settings, the tools
and the Codex box. Super+F1 lists the keys from `~/.config/cwm/cwmrc`.

On the X220, after the first boot, run `~/.local/share/vertrice/tests/check`
once, inside X. `~/.local/share/vertrice/tests/run` is the regression suite.

What vertrice is and why, in short: [OPENBSD.md](.local/share/vertrice/OPENBSD.md).
For agents, the spec and the decisions: [SPEC.md](.local/share/vertrice/SPEC.md).

## What differs from voidrice

| | voidrice | vertrice |
|---|---|---|
| Shell | zsh | ksh |
| Window manager | dwm | cwm, with dwm's keys; dwm with `WM=dwm` |
| Terminal | st | xterm |
| Root | sudo | doas |
| Status bar | dwmblocks | sbar: drawn by dwm, or a one-line terminal under cwm; Super+b as a notice |
| Sound | PipeWire | sndio |
| Wi-Fi | nmtui | `dmenuwifi`, Super+Shift+F11 |
| Download queue | task-spooler | nq |
| Archives | tar, unzip, 7z, unrar | bsdtar |
| Updates | pacman | syspatch and `pkg_add -u`, counted in the bar |
| Camera and microphone | on | off; `rectoggle`, Super+Ctrl+F11 |
| Touchpad | on | off; the TrackPoint scrolls |
| Backups | none | `bk`: dump(8) to a USB disk |
| Reminders | none | calendar(1), mailed by the nightly daily(8) run |
| Dictionary | none | `dict` and `roget`, from dictd on localhost |
| Codex | none | `cdxb`: Codex in an unveil(2) box |
| Key list, Super+F1 | the LARBS guide | the cwmrc in dmenu |

## Credits

vertrice is built on voidrice by [Luke Smith](https://lukesmith.xyz) and
voidrice's contributors; most of the scripts and configs are theirs. The
license is unchanged: GNU GPL version 3 (see [LICENSE](LICENSE)).

Default desktop artwork: Thomas Thiemeyer, *The Road to Samarkand*.
