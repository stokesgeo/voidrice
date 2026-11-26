# Crush OpenBSD source build

This bounded source overlay targets https://github.com/charmbracelet/crush at
`c62fa029f743047ab70fcc88cef9029be6c5beff` (v0.102.0). It is not a vendored
checkout or binary distribution.

`crush.patch` contains 26 modified files and 45 explicit additions: safety and
authority prompts, foreground worker shells, owner-terminal administrator
handoff, cancellation/outcome settlement and stream recovery, opt-in activity
export, and coherent UI support (folding, terminal themes, session identity and
optional vi editing). Tests accompany these changes. One exported session-label
test uses deliberately synthetic identity/title data rather than the maintained
source fixture. The sole local module replacement, `third_party/vimbubble`,
includes its upstream provenance and MIT license. `patch-files.txt` lists the
overlay and `source-manifest.json` pins all 1538 reconstructed source files/modes.

Patch SHA256:
`901bbdb831615ea13d0bb874ab81f09b2d73d6fd2a93aa84c5798227bfbd4e93`

Full reconstructed-source manifest SHA256:
`24bce35912c35c09e65669cbfcd102b8e0a3787d3bfadf7d9ff34a898c731993`

## Fresh acquisition and build

Requirements: ordinary-user OpenBSD/amd64, Python 3.12+, Git, native C compiler,
system TLS certificates and several GiB free on the chosen filesystem. Create a
mode-0700 private parent directory, then pass an absolute, nonexistent child:

```
python3 acquire.py --work /absolute/private-area/new-work
```

This explicitly networked setup fetches only the pinned public Crush commit,
Go1.27.4 OpenBSD/amd64 and the dependencies selected by its patched module files.
It does not inherit user authentication, Git configuration, proxy settings or
Go environment. Go module acquisition uses `https://proxy.golang.org` and the
public `sum.golang.org` checksum database, without direct VCS fallback. These
services receive public dependency requests; see https://proxy.golang.org/privacy.
The source tree must remain identical to the manifest after acquisition.

The compiler archive is `https://go.dev/dl/go1.27.4.openbsd-amd64.tar.gz`, allowing
only its exact HTTPS redirect to dl.google.com. Before extraction/execution it
must match 70076244 bytes and SHA256
`cb3b5da893614c4814c096052d7bc538d6743a33ddee3df06e060e1d3a7f7020`.
This pin comes from https://go.dev/dl/?mode=json&include=all and the release table
at https://go.dev/dl/. TLS uses the native system certificate bundle. Acquisitions
have finite bounds; failures retain the private workspace and refuse overwrite.
`--acquire-only` obtains and verifies inputs without compiling.

After acquisition, `acquisition.json` records public source/compiler pins. The
normal command invokes the offline builder and produces `build/crush` plus
`build/build-receipt.json`. The build receipt identifies the relative executable,
its SHA256, source pins, compiler version and completed targeted test checks.
Neither command installs anything or changes a launcher, current selector,
system installation, live configuration or authentication state.

## Offline build with explicit existing inputs

```
python3 build.py --upstream /absolute/clean-upstream-clone \
  --work /absolute/private-area/new-build \
  --go /absolute/existing-go/bin/go \
  --mod-cache /absolute/pre-acquired-module-cache
```

The clean clone must have public origin `https://github.com/charmbracelet/crush`
and HEAD at the pinned commit. The compiler must be exactly Go1.27.4
OpenBSD/amd64. The builder exports Git objects, verifies patch and full source
checksums, runs targeted regressions and the replacement's full suite, and builds
with `-mod=readonly -trimpath -buildvcs=false`, `CGO_ENABLED=1`, empty
`GOEXPERIMENT` and `GOTOOLCHAIN=local`. No automatic download occurs during the
offline build. HOME, config, cache and temporary files are isolated inside the
new work directory. Existing targets and unsafe parents are refused.

## Trust and qualification limits

The compiler, C compiler, Python, Git, system certificates and OS are trusted
inputs. Source hashes do not attest those tools, and single-machine build
receipts do not establish independent byte-identical reproducibility. Targeted
regression execution is not the full upstream suite; receipt success does not
claim live provider/authentication, privileged execution or OS network-sandbox
testing. Application use and installation are separate from this build route.
Retain upstream LICENSE.md (FSL-1.1-MIT) and the replacement MIT notice when
redistributing source or binaries, and review their terms.
