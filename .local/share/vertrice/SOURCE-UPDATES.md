# Source and system updates

## Keep the two repositories distinct

The source checkout is an ordinary working tree for reviewing and developing
changes. The installed dotfiles use a separate bare repository at
`~/.local/share/vertrice.git`, with HOME as its selected work tree. The shell's
`config` helper operates on that bare repository, not on the source checkout.
Uncommitted source changes are not installed changes.

Fresh-home checkout is described in the repository README. It is not adoption
of an existing installation into managed source updates. Adoption must preserve
local files, reviewed selection rules, branch/upstream identity and recovery
copies. Routine maintenance does not perform adoption. An unadopted layout
requires a separate reviewed migration; do not construct it by guessing Git
configuration or forcing a checkout.

## Routine maintenance

On a provisioned OpenBSD installation, the normal-user entrypoint is:

    vertrice-update

It requests local doas authentication for the root-owned system updater, then
runs the user phase without root privileges. The installed schedule runs the
same whole-machine update overnight. Root's separate update-count job reports
available updates; a count is not an installed update or a successful reboot.

User-only maintenance is available without the system phase:

    vertrice-update --user

The source channel currently expects a reviewed checkout at `~/src/vertrice`
and an adopted HOME deployment. It reads committed local `master`, fetches
public upstream for comparison, and does not merge upstream into the developer
working tree or deploy uncommitted work. HOME deployment only advances to the
accepted local commit after selection and overlap checks. An absent repository
is not created by routine maintenance. A fresh bare clone alone is not an
adopted deployment.

Review failures rather than deleting locks, retained candidates or local
changes. Preserve recovery material. Upstream changes need source integration
before deployment; selection changes need an explicit adoption decision.
Changes to root/service templates require maintenance review, not an automatic
rerun of `vertrice-install` or an assumed service restart.

## Assistant software and local state

Run `vertrice-pi-setup` as the ordinary user for first installation. It acquires
the pinned public build inputs and activates the assembled application. Pi
application generations and its local profile are separate. First-only setup
retains an existing installation rather than overwriting it. Its new private profile
contains generic settings and an empty `auth.json` (`{}`, mode 0600), not copied
credentials. Provider sign-in happens locally in the application.

For first-only Crush installation, run `vertrice-crush-setup` as the ordinary
user. It acquires pinned public source, Go and modules, then builds and installs
under `~/.local/share/vertrice-crush/generations`. It creates `current`
exclusively; an existing selector is retained without migration or overwrite.
Failed work is retained for review. If cleanup fails after activation, setup
reports installation success separately and retains the diagnostic workspace;
do not mistake that warning for a failed activation or force a replacement.
The `crush` launcher validates the selected private generation and refuses
missing or invalid state, with no system-binary fallback. Native HOME/XDG configuration and local provider sign-in are unchanged;
no root build or historical runtime is required.

The [Crush source-build guide](../openbsd/crush/README.md) describes acquisition
and an alternative offline build using explicitly pre-acquired inputs. Those
low-level build commands produce a binary, not an installation. Retain upstream
`LICENSE.md` (FSL-1.1-MIT) and the replacement MIT notice when redistributing,
and review their terms.

Pins identify reproducible release inputs, not a permanent version policy.
Future source and dependency changes need qualification together and new build
evidence, not an assumption that untested latest versions are compatible.
Do not substitute a stock upstream installation for the supported safety
behavior or assume a prepared generation is active. Both Pi and Crush are
required. Check account sign-in and actual application use locally; source and
build checks do not establish hardware compatibility or provider access.

Package admission requires the installed scanner and a readable current ClamAV
database. The system installer provisions `/etc/clamav-certs`, refreshes
signatures in the foreground and installs a daily refresh job. A scanner error,
missing certificate or stale database must be resolved rather than bypassed.
Checks reduce risk; they are not proof that arbitrary software is safe.

Keep provider credentials, sessions, personal task stores and account settings
out of source commits and transfer media. Native permission prompts remain in
use; public read grants do not authorize writes, commands or administrator work.
