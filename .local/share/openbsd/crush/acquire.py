#!/usr/bin/env python3
"""Acquire pinned public build inputs into a new private workspace, then build offline."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.request

sys.dont_write_bytecode = True
import build

GO_URL = "https://go.dev/dl/go1.27.4.openbsd-amd64.tar.gz"
GO_SHA256 = "cb3b5da893614c4814c096052d7bc538d6743a33ddee3df06e060e1d3a7f7020"
GO_SIZE = 70076244


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        if newurl != "https://dl.google.com/go/go1.27.4.openbsd-amd64.tar.gz":
            raise ValueError("unexpected toolchain download redirect")
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(destination):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_verify_locations(cafile="/etc/ssl/cert.pem")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context), PublicRedirect())
    digest = hashlib.sha256()
    size = 0
    deadline = time.monotonic() + 600
    with opener.open(GO_URL, timeout=60) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > GO_SIZE or time.monotonic() > deadline:
                raise ValueError("toolchain download exceeded size/time bound")
            digest.update(chunk)
            output.write(chunk)
    if size != GO_SIZE or digest.hexdigest() != GO_SHA256:
        raise ValueError("toolchain archive checksum/size mismatch")


def extract(archive, destination):
    with tarfile.open(archive) as tar:
        members = tar.getmembers()
        if sum(m.size for m in members) > 1024 * 1024 * 1024:
            raise ValueError("toolchain expanded size exceeded")
        for member in members:
            parts = Path(member.name).parts
            if not parts or parts[0] != "go" or member.name.startswith("/") or ".." in parts or not (member.isfile() or member.isdir()):
                raise ValueError("unsafe toolchain archive entry")
        tar.extractall(destination, filter="data")


def execute(command, env, cwd=None, timeout=1800):
    subprocess.run(command, cwd=cwd, env=env, check=True, timeout=timeout, stdin=subprocess.DEVNULL)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", required=True, help="nonexistent child of current-user-owned mode-0700 parent")
    parser.add_argument("--acquire-only", action="store_true", help="acquire and verify inputs without compiling")
    args = parser.parse_args()
    if os.getuid() == 0 or not sys.platform.startswith("openbsd") or platform.machine() != "amd64":
        raise ValueError("requires ordinary-user OpenBSD/amd64")
    patch = build.checked_asset("crush.patch", build.PATCH_SHA256)
    manifest = json.loads(build.checked_asset("source-manifest.json", build.MANIFEST_SHA256))
    work = build.fresh_work(args.work)
    work.mkdir(mode=0o700)
    for name in ("home", "tmp", "cache", "modules"):
        (work / name).mkdir(mode=0o700)
    env = {"PATH": "/bin:/usr/bin:/usr/local/bin", "LANG": "C", "HOME": str(work / "home"), "TMPDIR": str(work / "tmp"), "GOTMPDIR": str(work / "tmp"), "GOCACHE": str(work / "cache"), "GOMODCACHE": str(work / "modules"), "GOTOOLCHAIN": "local", "GOENV": "off", "GOWORK": "off", "GOFLAGS": "-mod=readonly", "GOEXPERIMENT": "", "CGO_ENABLED": "1", "GOPROXY": "https://proxy.golang.org", "GOSUMDB": "sum.golang.org", "GOPRIVATE": "", "GONOPROXY": "none", "GONOSUMDB": "none", "GOVCS": "*:off", "GOAUTH": "off", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"}
    git = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "credential.helper=", "-c", "http.proxy=", "-c", "http.sslVerify=true", "-c", "http.sslCAInfo=/etc/ssl/cert.pem"]
    upstream = work / "upstream"
    execute(git + ["init", "--template=", str(upstream)], env, timeout=60)
    execute(git + ["-C", str(upstream), "remote", "add", "origin", build.ORIGIN], env, timeout=60)
    execute(git + ["-C", str(upstream), "fetch", "--depth=1", "origin", build.COMMIT], env, timeout=600)
    execute(git + ["-C", str(upstream), "checkout", "--detach", build.COMMIT], env, timeout=60)
    archive = work / "go.tar.gz"
    download(archive)
    extract(archive, work)
    go = work / "go/bin/go"
    if build.run([str(go), "version"], env=env) != "go version go1.27.4 openbsd/amd64":
        raise ValueError("downloaded compiler version mismatch")
    source = work / "module-source"
    source.mkdir(mode=0o700)
    data = subprocess.check_output(git + ["-C", str(upstream), "archive", build.COMMIT], env=env, timeout=60)
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar.getmembers():
            if member.name.startswith("/") or ".." in Path(member.name).parts or not (member.isfile() or member.isdir()):
                raise ValueError("unsafe upstream entry")
        tar.extractall(source, filter="data")
    subprocess.run(["git", "apply", "-"], input=patch, cwd=source, env=env, check=True, timeout=60)
    build.verify_source(source, manifest)
    for root in (source, source / "third_party/vimbubble"):
        execute([str(go), "mod", "download"], env, cwd=root)
        execute([str(go), "mod", "verify"], env, cwd=root)
    build.verify_source(source, manifest)
    receipt = {"upstream": build.ORIGIN, "commit": build.COMMIT, "patch_sha256": build.PATCH_SHA256, "source_manifest_sha256": build.MANIFEST_SHA256, "go_url": GO_URL, "go_sha256": GO_SHA256, "module_proxy": "https://proxy.golang.org", "checksum_database": "sum.golang.org", "source_unchanged_after_acquisition": True}
    (work / "acquisition.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("Acquisition verified; receipt:", work / "acquisition.json", flush=True)
    if not args.acquire_only:
        execute([sys.executable, str(Path(__file__).with_name("build.py")), "--upstream", str(upstream), "--work", str(work / "build"), "--go", str(go), "--mod-cache", str(work / "modules")], env, timeout=7200)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit("acquire: " + str(error))
