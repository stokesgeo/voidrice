#!/usr/bin/env python3
"""Offline, ordinary-user build from an explicitly acquired upstream repository."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile

COMMIT = "c62fa029f743047ab70fcc88cef9029be6c5beff"
ORIGIN = "https://github.com/charmbracelet/crush"
PATCH_SHA256 = "901bbdb831615ea13d0bb874ab81f09b2d73d6fd2a93aa84c5798227bfbd4e93"
MANIFEST_SHA256 = "24bce35912c35c09e65669cbfcd102b8e0a3787d3bfadf7d9ff34a898c731993"
TEST_PATTERN = "Test(Lifecycle|ConcurrentAndHeartbeat|DisabledAndPrivateRoot|InstancesAndUnsafeSessionNames|RunActivity|WorkerTools|CoderContext|TaskContext|BuiltBash|CanContinueStream|RunStreamContinuation|StreamContinuation|SettlementFailure|RunSettlement|RunCanceledToolResult|ForegroundBash|BashBackgroundPolicy|BashPolicyDescriptions|Admin|PermissionActivity|QuestionActivity|Vi|FollowsTerminal|TerminalTheme|SameTerminalColor|SessionIdentityLine|ToolItemsStartFolded)"


def checked_asset(name, expected):
    data = (Path(__file__).resolve().parent / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(name + " checksum mismatch")
    return data


def run(args, cwd=None, env=None):
    return subprocess.check_output(args, cwd=cwd, env=env).decode().strip()


def fresh_work(raw):
    path = Path(raw)
    if not path.is_absolute() or str(path) != raw or ".." in path.parts:
        raise ValueError("work must be a normalized absolute path")
    if path.parent.resolve() != path.parent:
        raise ValueError("work parent must not traverse symlinks")
    parent = path.parent.stat()
    if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
        raise ValueError("work parent must be current-user-owned mode 0700")
    if os.path.lexists(path):
        raise ValueError("work already exists; refusing overwrite")
    return path


def verify_source(root, manifest):
    actual = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("symlink in reconstructed source")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("nonregular source entry")
        mode = "100755" if path.stat().st_mode & 0o111 else "100644"
        actual[path.relative_to(root).as_posix()] = {
            "mode": mode, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()
        }
    if actual != manifest:
        raise ValueError("reconstructed source differs from full manifest")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, help="explicit clean upstream Git clone")
    parser.add_argument("--work", required=True, help="new child of a private mode-0700 directory")
    parser.add_argument("--go", required=True, help="absolute path to existing Go 1.27.4 executable")
    parser.add_argument("--mod-cache", required=True, help="absolute path to pre-acquired Go module cache")
    args = parser.parse_args()
    if os.getuid() == 0 or not sys.platform.startswith("openbsd"):
        raise ValueError("run as an ordinary user on OpenBSD")
    patch = checked_asset("crush.patch", PATCH_SHA256)
    manifest = json.loads(checked_asset("source-manifest.json", MANIFEST_SHA256))
    work = fresh_work(args.work)
    upstream = Path(args.upstream)
    go = Path(args.go)
    if not upstream.is_absolute() or not go.is_absolute() or not go.is_file():
        raise ValueError("upstream and existing Go executable must be absolute paths")
    env = {"PATH": "/bin:/usr/bin:/usr/local/bin", "LANG": "C", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}
    env.update(HOME=str(work / "home"), XDG_CONFIG_HOME=str(work / "home/config"), XDG_CACHE_HOME=str(work / "home/cache"), TMPDIR=str(work / "tmp"), GOTMPDIR=str(work / "tmp"), GOCACHE=str(work / "cache"))
    if not Path(args.mod_cache).is_absolute() or not Path(args.mod_cache).is_dir():
        raise ValueError("module cache must be an existing absolute directory")
    env.update(GOMODCACHE=args.mod_cache, GOTOOLCHAIN="local", GOENV="off", GOWORK="off", GOFLAGS="", GOEXPERIMENT="", CGO_ENABLED="1", GOPROXY="off", GOSUMDB="off")
    git = ["git", "--no-replace-objects", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", str(upstream)]
    if run(git + ["rev-parse", "HEAD"], env=env) != COMMIT:
        raise ValueError("upstream HEAD is not the pinned commit")
    if run(git + ["remote", "get-url", "origin"], env=env) != ORIGIN:
        raise ValueError("upstream origin is not the pinned public URL")
    if run(git + ["status", "--porcelain", "--untracked-files=all"], env=env):
        raise ValueError("upstream clone must be clean")
    if run([str(go), "version"], env=env) != "go version go1.27.4 openbsd/amd64":
        raise ValueError("requires existing Go 1.27.4 openbsd/amd64; no automatic download")
    archive = subprocess.check_output(git + ["archive", "--format=tar", COMMIT], env=env)
    work.mkdir(mode=0o700)
    for name in ("home", "tmp", "cache"):
        (work / name).mkdir(mode=0o700)
    source = work / "source"
    source.mkdir(mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            parts = Path(member.name).parts
            if member.name.startswith("/") or ".." in parts or not (member.isfile() or member.isdir()):
                raise ValueError("unsafe upstream archive entry")
        tar.extractall(source, filter="data")
    subprocess.run(["git", "apply", "--check", "-"], input=patch, cwd=source, env=env, check=True)
    subprocess.run(["git", "apply", "-"], input=patch, cwd=source, env=env, check=True)
    verify_source(source, manifest)
    common = [str(go), "test", "-mod=readonly", "-trimpath", "-buildvcs=false", "-count=1", "-timeout=600s"]
    subprocess.run(common + ["-run", TEST_PATTERN, "./internal/activity", "./internal/agent", "./internal/agent/tools", "./internal/permission", "./internal/question", "./internal/shellconfig", "./internal/config", "./internal/ui/chat", "./internal/ui/model"], cwd=source, env=env, check=True)
    subprocess.run(common + ["./..."], cwd=source / "third_party/vimbubble", env=env, check=True)
    identity = COMMIT + "." + PATCH_SHA256[:16]
    package = "github.com/charmbracelet/crush/internal/version."
    flags = " ".join("-X " + package + k + "=" + v for k, v in [("Version", "0.102.0+vertrice.safety"), ("Commit", COMMIT), ("BuildID", identity)])
    binary = work / "crush"
    subprocess.run([str(go), "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags", flags, "-o", str(binary), "."], cwd=source, env=env, check=True)
    verify_source(source, manifest)
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    receipt = {"version": 1, "binary": "crush", "binary_sha256": digest, "upstream": ORIGIN, "commit": COMMIT, "patch_sha256": PATCH_SHA256, "source_manifest_sha256": MANIFEST_SHA256, "go_version": "go1.27.4 openbsd/amd64", "targeted_tests": "passed", "replacement_tests": "passed", "source_manifest": "verified-before-and-after-build"}
    (work / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("Built (not installed):", binary)
    print("SHA256:", digest)
    print("Receipt:", work / "build-receipt.json")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit("build: " + str(error))
