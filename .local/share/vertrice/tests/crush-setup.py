#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[4]
BIN = ROOT / ".local/bin/openbsd"


def sha(data):
    return hashlib.sha256(data).hexdigest()


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="crush-setup-test-")
        self.home = Path(self.scratch.name)
        self.assets = self.home / ".local/share/openbsd/crush"
        self.assets.mkdir(parents=True)
        self.app = self.home / ".local/share/vertrice-crush"
        self.cwd = self.home / "cwd"
        self.cwd.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), XDG_CONFIG_HOME=str(self.home / "config"), XDG_DATA_HOME=str(self.home / "data"), XDG_STATE_HOME=str(self.home / "state"), XDG_CACHE_HOME=str(self.home / "cache"), SECRET_SENTINEL="not-for-build")
        self.state = self.home / "config/crush/credentials.json"
        self.state.parent.mkdir(parents=True)
        self.state.write_text("private-existing-sign-in")
        self.sources = {"LICENSE.md": b"FSL fixture", "third_party/vimbubble/LICENSE": b"MIT fixture"}
        manifest = {name: {"mode": "100644", "sha256": sha(data)} for name, data in self.sources.items()}
        raw = json.dumps(manifest).encode()
        (self.assets / "source-manifest.json").write_bytes(raw)
        (self.assets / "crush.patch").write_bytes(b"fixture")
        self.identity = {"upstream": "https://github.com/charmbracelet/crush", "commit": "a" * 40, "patch_sha256": sha(b"fixture"), "source_manifest_sha256": sha(raw), "source_unchanged_after_acquisition": True}
        constants = {"ORIGIN": self.identity["upstream"], "COMMIT": self.identity["commit"], "PATCH_SHA256": self.identity["patch_sha256"], "MANIFEST_SHA256": self.identity["source_manifest_sha256"]}
        (self.assets / "build.py").write_text("\n".join(k + " = " + repr(v) for k, v in constants.items()))
        self.fixture()

    def tearDown(self):
        self.scratch.cleanup()

    def fixture(self, mode="ok"):
        binary = "#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps({'argv':sys.argv[1:],'cwd':os.getcwd(),'env':dict(os.environ)}))\n"
        code = f'''import json,os,sys
from pathlib import Path
assert sys.argv[1] == '--work' and len(sys.argv) == 3
w = Path(sys.argv[2])
assert not os.path.lexists(w)
assert w.parent.stat().st_mode & 0o777 == 0o700
assert 'SECRET_SENTINEL' not in os.environ
w.mkdir(mode=0o700)
(w/'modules').mkdir(mode=0o700)
cache = w/'modules/readonly-cache'
cache.mkdir(mode=0o700)
(cache/'module').write_text('readonly module')
(cache/'module').chmod(0o444)
cache.chmod(0o555)
if {mode!r} == 'unsafe-cleanup':
    unsafe = w/'unsafe-cleanup'
    unsafe.mkdir(mode=0o700)
    unsafe.chmod(0o777)
(w/'acquisition.json').write_text({json.dumps(self.identity)!r})
print('synthetic acquisition completed', flush=True)
if {mode!r} == 'fail': sys.exit(3)
(w/'build').mkdir(mode=0o700)
s = w/'build/source'
s.mkdir(mode=0o700)
for name, data in {self.sources!r}.items():
    p = s/name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
if {mode!r} == 'notice': (s/'LICENSE.md').unlink()
if {mode!r} != 'binary':
    p = w/'build/crush'
    p.write_text({binary!r})
    p.chmod(0o700)
if {mode!r} == 'hardlink': os.link(w/'build/crush', w/'linked')
if {mode!r} == 'writable': (w/'build/crush').chmod(0o777)
if {mode!r} == 'race': (w.parent.parent/'current').symlink_to('owner-preserved')
'''
        (self.assets / "acquire.py").write_text(code)

    def run_entry(self, name, *args):
        return subprocess.run([sys.executable, str(BIN / name), *args], env=self.env, cwd=self.cwd, text=True, capture_output=True)

    def test_install_launch_preserves_runtime(self):
        result = self.run_entry("vertrice-crush-setup")
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.run_entry("crush", "a b", "--literal=$HOME", "")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["argv"], ["a b", "--literal=$HOME", ""])
        self.assertEqual(output["cwd"], str(self.cwd))
        for key in ("HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "SECRET_SENTINEL"):
            self.assertEqual(output["env"][key], self.env[key])
        self.assertEqual(self.state.read_text(), "private-existing-sign-in")
        self.assertFalse(list(self.app.glob("setup-*")))
        selected = os.readlink(self.app / "current")
        self.assertEqual(self.run_entry("vertrice-crush-setup").returncode, 0)
        self.assertEqual(os.readlink(self.app / "current"), selected)

    def test_failed_and_incomplete_builds(self):
        for mode in ("fail", "notice", "binary", "hardlink", "writable"):
            with self.subTest(mode=mode):
                self.fixture(mode)
                result = self.run_entry("vertrice-crush-setup")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(os.path.lexists(self.app / "current"))
                retained = list(self.app.glob("setup-*"))
                self.assertTrue(retained)
                for scratch in retained:
                    self.assertEqual(scratch.stat().st_uid, os.getuid())
                    self.assertEqual(scratch.stat().st_mode & 0o777, 0o700)
                    self.assertIn("synthetic acquisition completed", (scratch / "build.log").read_text())
                    self.assertTrue((scratch / "work/acquisition.json").is_file())
                self.assertIn("retained diagnostic workspace:", result.stderr)

    def test_postpublication_untrusted_cleanup_directory(self):
        self.fixture("unsafe-cleanup")
        result = self.run_entry("vertrice-crush-setup")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("installed successfully; retained workspace after cleanup failure:", result.stderr)
        self.assertIn("untrusted directory:", result.stderr)
        current = self.app / "current"
        selected = os.readlink(current)
        scratch = next(self.app.glob("setup-*"))
        self.assertEqual((scratch / "work/unsafe-cleanup").stat().st_mode & 0o777, 0o777)
        self.assertEqual(self.run_entry("crush").returncode, 0)
        self.assertEqual(self.run_entry("vertrice-crush-setup").returncode, 0)
        self.assertEqual(os.readlink(current), selected)

    def test_postpublication_cleanup_failure(self):
        code = "import os,runpy,shutil; from pathlib import Path; " + \
            "current=Path(os.environ['HOME'])/'.local/share/vertrice-crush/current'; " + \
            "original=shutil.rmtree; " + \
            "exec('def fail_cleanup(path, *args, **kwargs):\\n assert current.is_symlink()\\n assert Path(path).name.startswith(\"setup-\")\\n raise PermissionError(\"synthetic cleanup refusal\")'); " + \
            "shutil.rmtree=fail_cleanup; runpy.run_path(" + repr(str(BIN / "vertrice-crush-setup")) + ",run_name='__main__')"
        result = subprocess.run([sys.executable, "-c", code], env=self.env, cwd=self.cwd, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("installed successfully; retained workspace after cleanup failure:", result.stderr)
        current = self.app / "current"
        selected = os.readlink(current)
        self.assertTrue((current / "installation.json").is_file())
        self.assertEqual(len(list(self.app.glob("setup-*"))), 1)
        self.assertEqual(self.run_entry("crush", "--version").returncode, 0)
        self.assertEqual(self.run_entry("vertrice-crush-setup").returncode, 0)
        self.assertEqual(os.readlink(current), selected)

    def test_selector_race(self):
        self.fixture("race")
        self.assertNotEqual(self.run_entry("vertrice-crush-setup").returncode, 0)
        self.assertEqual(os.readlink(self.app / "current"), "owner-preserved")
        self.assertEqual(len(list((self.app / "generations").glob("gen-*"))), 1)
        self.assertEqual(len(list(self.app.glob("setup-*"))), 1)

    def test_dangling_and_foreign_selectors(self):
        self.app.mkdir(mode=0o700)
        current = self.app / "current"
        for target in ("absent", "/usr/local/bin/crush", "generations/../outside"):
            current.symlink_to(target)
            self.assertEqual(self.run_entry("vertrice-crush-setup").returncode, 0)
            self.assertEqual(os.readlink(current), target)
            self.assertNotEqual(self.run_entry("crush").returncode, 0)
            current.unlink()

    def test_untrusted_app_root(self):
        self.app.symlink_to(self.cwd)
        self.assertNotEqual(self.run_entry("vertrice-crush-setup").returncode, 0)

    def test_missing_never_falls_back(self):
        self.assertNotEqual(self.run_entry("crush").returncode, 0)
        (self.assets / "acquire.py").unlink()
        self.assertNotEqual(self.run_entry("vertrice-crush-setup").returncode, 0)

    def test_tampered_generation(self):
        self.assertEqual(self.run_entry("vertrice-crush-setup").returncode, 0)
        generation = (self.app / "current").resolve()
        notice = generation / "notices/LICENSE.md"
        notice.chmod(0o600)
        notice.write_text("changed")
        self.assertNotEqual(self.run_entry("crush").returncode, 0)


if __name__ == "__main__":
    if os.getuid() == 0:
        raise SystemExit("tests require an ordinary user")
    system = Path("/usr/local/bin/crush")
    before = sha(system.read_bytes()) if system.is_file() else None
    suite = unittest.main(exit=False)
    after = sha(system.read_bytes()) if system.is_file() else None
    if before != after:
        raise SystemExit("system Crush changed")
    raise SystemExit(not suite.result.wasSuccessful())
