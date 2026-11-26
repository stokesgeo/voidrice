#!/usr/local/bin/python3
"""Source-only native integration. Synthetic HOME/mail/keyring; no external network.

Runtime's loopback rejection fixture is reused, not a second protocol harness.
Full enrollment tests reuse the lifecycle fixture with its unchanged deadlines.
"""
import importlib.util
import base64
import socket
import threading
import fcntl
import struct
import termios
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import subprocess
import time
import unittest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ASSETS = REPO / '.local/share/openbsd/mail/mutt-wizard'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


runtime = module('runtime_fixture', 'mutt-wizard-runtime.py')
legacy = module('lifecycle_fixture', 'mutt-wizard.py')


def tty(test, argv, steps, env):
    """Actual controlling PTY; no owner terminal, desktop, editor or sends."""
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
        os.execve('/usr/local/bin/neomutt', ['neomutt', *argv], env)
    transcript = b''
    status = None
    try:
        for send, expected in steps:
            if send:
                os.write(fd, send)
            start = len(transcript)
            end = time.monotonic() + 8
            while time.monotonic() < end:
                if select.select([fd], [], [], .05)[0]:
                    try:
                        transcript += os.read(fd, 65536)
                    except OSError:
                        break
                if expected in transcript[start:]:
                    break
            test.assertIn(expected, transcript[start:], transcript.decode(errors='replace'))
        os.write(fd, b'\x07q')  # abort any prompt, quit empty index
        end = time.monotonic() + 3
        while time.monotonic() < end:
            if select.select([fd], [], [], .05)[0]:
                try:
                    transcript += os.read(fd, 65536)
                except OSError:
                    pass
            got, status = os.waitpid(pid, os.WNOHANG)
            if got:
                break
            status = None
        # Some flows deliberately leave a compose/error prompt; never send.
        return transcript
    finally:
        if status is None:
            os.killpg(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        os.close(fd)


class Plumbing(runtime.Runtime):
    def run_cmd(self, argv, **kwargs):
        # The private source build's output is a sibling of fixture HOME.
        # Qualify under its containing private root, also on HOME-filesystem
        # TMPDIR; runtime commands still use the isolated account HOME.
        if len(argv)>1 and argv[1] in [str(ASSETS/'build'),str(ASSETS/'runtime-build')]:
            return subprocess.run(argv,env=dict(self.env,HOME=str(self.root)),
                                  stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE,timeout=8,**kwargs)
        return super().run_cmd(argv,**kwargs)

    def setUp(self):
        super().setUp()
        self.mw = self.bin / 'mw'
        (self.bin / 'vertrice-mail').symlink_to(self.mw)
        p = self.run_cmd(['sh', str(ASSETS / 'build'), str(self.mw)])
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_integration_help_contract(self):
        p = self.run_cmd([str(self.mw), '-h'])
        # Baseline and overlay use the catch-all branch for -h, exiting 1.
        self.assertEqual(p.returncode, 1)
        self.assertEqual(p.stderr, b'')
        text = p.stdout.decode()
        for token in ('mutt-wizard for OpenBSD', '-a email', '-e email',
                      '-R email', '-d ', '-D email', '-l ', '-y email', '-Y ',
                      'Removal preserves all pass entries, messages, Maildirs and caches',
                      '-X purge unsupported', 'Sending disabled', 'PullNew only',
                      'POP, automatic sync/cron (-t/-T)', 'exits 1'):
            self.assertIn(token, text)
        for stale in ('port review delta', 'NO ADOPTION', 'incomplete lifecycle'):
            self.assertNotIn(stale, text)
        self.assertFalse((self.home / '.config').exists())
        self.assertFalse(self.calls.exists())

    def generate(self):
        # Execute the actual candidate's original generator function, not a
        # separately reimplemented template. No credentials in this operation.
        source = self.mw.read_text()
        function = source[source.index('prepmbsync()'):source.index('prepmpop()')]
        serializer = source[source.index('mw_passcmd()'):source.index('mw_owned()')]
        script = f'''PASSWORD_STORE_DIR={self.home}/synthetic-store
mw_ref=fixture@example.invalid
maildir={self.home}/mail
mbsyncrc={self.cfg}
fulladdr=fixture@example.invalid
imap=imap.example.invalid
iport=993
login=fixture
sslcert=/etc/ssl/cert.pem
{serializer}
{function}
prepmbsync
'''
        self.cfg.unlink(missing_ok=True)
        p = self.run_cmd(['/bin/sh', '-c', script])
        self.assertEqual(p.returncode, 0, p.stderr)
        return self.cfg.read_text()

    def manual_command(self):
        source = self.mw.read_text()
        function = source[source.index('prepmutt()'):source.index('getprofiles()')]
        # Use the core's actual literal serializer, now also used by mailcap
        # and the nested compose echo macro. Do not hand-copy its quoting.
        function += '\n'+source[source.index('mw_neoq()'):].split('\n',1)[0]+'\n'
        accounts = self.home / 'generated-accounts'
        accounts.mkdir(exist_ok=True)
        p = self.run_cmd(['/bin/sh', '-c', f'''accdir={accounts}
fulladdr=fixture@example.invalid
muttrc={self.home}/generated-muttrc
live_accdir={accounts}
live_muttrc=$muttrc
binding='i1<Enter>'
{function}
prepmutt
'''])
        self.assertEqual(p.returncode, 0, p.stderr)
        account = (accounts / 'fixture@example.invalid.muttrc').read_text()
        return re.search(r'^macro index,pager O "<shell-escape>(.*?)<enter>"', account, re.M).group(1)

    def manual_sync(self):
        return self.run_cmd(['/bin/sh', '-c', self.manual_command()])

    def script(self, name, text):
        if name == 'pass' and 'PASS_ENV_CAPTURE' in self.env:
            text = '/usr/bin/env > "$PASS_ENV_CAPTURE"\n' + text
        return super().script(name, text)

    def secret_canaries(self):
        capture = self.root / 'synthetic-child-env'
        self.env.update(PASS_ENV_CAPTURE=str(capture),
                        value='synthetic-old-entry', first='synthetic-old-first',
                        line='synthetic-unused-line', SHELLOPTS='allexport:xtrace')
        # A builtin-only selector must never launch head with the full entry.
        self.script('head', 'echo unexpected-head >> "$CALLS"; exit 78\n')
        return capture

    def assert_clean_pass_child(self, capture):
        environment = dict(line.split('=', 1) for line in capture.read_text().splitlines())
        self.assertNotIn('value', environment)
        self.assertNotIn('first', environment)
        self.assertEqual(environment.get('line'), 'synthetic-unused-line')
        self.assertFalse(self.calls.exists())

    def test_integration_manual_generated_command_and_refusal(self):
        self.assertEqual(self.manual_command(), 'vertrice-mail -Y')
        self.mock_sync()
        self.assertEqual(self.manual_sync().returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 2)
        self.calls.unlink()
        self.assertEqual(self.run_cmd(['mw', '-y', 'alpha']).returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 1)
        self.calls.unlink()
        for args in (['-y', ''], ['-y', '-a'], ['-y', 'alpha:INBOX'],
                     ['-y', 'missing'], ['-Y', 'alpha'], ['-Y', '-y', 'alpha'],
                     ['-T'], ['-t', '10']):
            self.assertNotEqual(self.run_cmd(['mw', *args]).returncode, 0, args)
            self.assertFalse(self.calls.exists())
        # Later PATH has a dangerous package-like fallback: it must not run.
        fallback = self.root / 'package-bin'
        fallback.mkdir()
        path = fallback / 'mailsync'
        path.write_text('#!/bin/sh\necho unsafe-fallback >> "$CALLS"\n')
        path.chmod(0o700)
        self.env['PATH'] = f'{self.bin}:{fallback}:/bin:/usr/bin:/usr/local/bin'
        own = self.bin / 'mailsync'
        saved = self.bin / 'reviewed-mailsync'
        own.rename(saved)
        for replacement in ('missing', 'packaged', 'symlink'):
            if replacement == 'packaged':
                import shutil
                shutil.copy2(ASSETS / 'originals/mailsync', own)
            elif replacement == 'symlink':
                own.symlink_to(saved)
            p = self.manual_sync()
            self.assertNotEqual(p.returncode, 0)
            self.assertIn(b'reviewed sibling mailsync missing or mismatched', p.stderr)
            self.assertFalse(self.calls.exists())
            own.unlink(missing_ok=True)

    def test_integration_existing_openbsd_path_selection(self):
        # Execute only the canonical PATH block in a synthetic HOME, never the
        # full login profile (desktop, preferences and private state excluded).
        import shutil
        profile = (REPO / '.config/shell/profile').read_text()
        start = profile.index('os=$(uname | tr A-Z a-z)\n')
        end = profile.index('\nexport PATH\n', start) + len('\nexport PATH\n')
        path_block = profile[start:end]
        own = self.home / '.local/bin/openbsd'
        own.mkdir(parents=True)
        package = self.root / 'package-bin'
        package.mkdir()
        for name in ('mw', 'mailsync'):
            shutil.copy2(self.bin / name, own / name)
            (package / name).write_text('#!/bin/sh\nexit 99\n')
            (package / name).chmod(0o700)
            generic = self.home / '.local/bin' / name
            generic.write_text('#!/bin/sh\nexit 98\n')
            generic.chmod(0o700)
        self.mock_sync()
        # Keep native utilities and mocked mbsync available; the package fixture
        # is deliberately ahead of generic local-bin, not ahead of OpenBSD.
        initial = f'{self.bin}:/bin:/usr/bin:{package}:/usr/local/bin'
        self.env['PATH'] = initial
        p = self.run_cmd(['/bin/sh', '-c', path_block + '\nprintf "%s\\n" "$PATH"'])
        self.assertEqual(p.returncode, 0, p.stderr)
        selected = p.stdout.decode().strip()
        paths = selected.split(':')
        self.assertEqual(paths[0], str(own))
        self.assertLess(paths.index(str(package)), paths.index(str(own.parent)))
        self.assertEqual(len(paths), len(set(paths)))
        self.env['PATH'] = selected
        # A second evaluation must not duplicate or reorder existing entries.
        p = self.run_cmd(['/bin/sh', '-c', path_block + '\nprintf "%s\\n" "$PATH"'])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.decode().strip(), selected)
        for name in ('mw', 'mailsync'):
            p = self.run_cmd(['/bin/sh', '-c', 'command -v ' + name])
            self.assertEqual(p.stdout.decode().strip(), str(own / name))
        self.assertEqual(self.run_cmd(['mw', '-Y']).returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 2)

    def test_integration_shared_prefix_guard(self):
        source = self.mw.read_text()
        guard = source[source.index('mw_reader_safe()'):source.index('mw_transport()')]
        accounts = self.home / 'accounts'
        accounts.mkdir()
        reader = self.home / 'reader'
        for text, allowed in [
            ('bind index,pager i noop\n', False),
            ('# mw shared selector prefix\nbind index,pager i noop\n', True),
            ('# mw shared selector prefix\n# foreign gap\nbind index,pager i noop\n', False),
        ]:
            reader.write_text(text)
            script = f'accdir={accounts}\n{guard}\nmw_reader_safe {reader} 1\n'
            p = self.run_cmd(['/bin/sh', '-c', script])
            self.assertEqual(p.returncode == 0, allowed, text)

    def test_integration_generated_passcmd_native(self):
        config = self.generate()
        command = re.search(r'^PassCmd "(.*)"$', config, re.M).group(1)
        self.assertIn('/bin/ksh -c', command)  # builtin printf, no secret argv
        # Reference/store are literal positional arguments to native ksh,
        # not unquoted shell words appended to pass show.
        import shlex
        actual=shlex.split(config.split('PassCmd ',1)[1].splitlines()[0])[0]
        words=shlex.split(actual)
        self.assertEqual(words[-2:],[str(self.home/'synthetic-store'),'fixture@example.invalid'])
        self.assertIn('pass show "$2"',words[2])
        self.assertIn('PASSWORD_STORE_DIR="$1"',words[2])
        capture = self.secret_canaries()
        for mode in ('metadata', 'fail-output', 'fail-empty', 'empty',
                     'empty-firstline', 'native-fail-output'):
            with self.subTest(mode=mode):
                self.native_pass_case(mode, command)
                # native-fail-output deliberately bypasses PassCmd to test isync.
                if mode != 'native-fail-output':
                    self.assert_clean_pass_child(capture)

    def test_integration_passcmd_runtime_shell_options(self):
        command = re.search(r'^PassCmd "(.*)"$', self.generate(), re.M).group(1)
        capture = self.secret_canaries()
        # ksh does not import bash SHELLOPTS. Also force its actual runtime
        # options: the body itself must turn both off before any secret work.
        forced = command.replace('/bin/ksh -c', '/bin/ksh -ax -c')
        self.native_pass_case('metadata', forced)
        self.assert_clean_pass_child(capture)
        # Native wrapper intentionally suppresses child diagnostics. Separately
        # capture the decoded PassCmd itself so that xtrace cannot hide there.
        # Only synthetic fixture data exists in this environment.
        p = self.run_cmd(['/bin/sh', '-c', forced.replace(r'\"', '"')])
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout, b'synthetic-password')
        for canary in (b'synthetic-password', b'fixture-metadata',
                       b'synthetic-old-entry', b'synthetic-old-first'):
            self.assertNotIn(canary, p.stderr)
        self.assert_clean_pass_child(capture)

    def test_integration_native_maildir_pullnew(self):
        config = self.generate()
        far = self.root / 'far'
        for leaf in ('cur', 'new', 'tmp'):
            (far / 'INBOX' / leaf).mkdir(parents=True)
        message = b'From: synthetic@example.invalid\nTo: fixture@example.invalid\nSubject: synthetic integration\nMessage-ID: <fixture-1@example.invalid>\n\nSynthetic only.\n'
        source = far / 'INBOX/cur/fixture:2,S'
        source.write_bytes(message)
        # Native Maildir far side replaces ONLY transport. Generated near side,
        # channel and all sync policy lines are used verbatim by real mbsync.
        config = re.sub(r'IMAPStore .*?\n\nMaildirStore',
                        f'MaildirStore fixture@example.invalid-remote\nPath {far}/\nInbox {far}/INBOX\nSubfolders Verbatim\n\nMaildirStore',
                        config, count=1, flags=re.S)
        self.cfg.write_text(config)
        near = self.home / 'mail/fixture@example.invalid/INBOX'
        near.parent.mkdir(parents=True)  # normal postcommit account root
        self.assertFalse(near.exists())
        self.assertEqual(self.manual_sync().returncode, 0)
        files = lambda d: sorted(p for leaf in ('new', 'cur') for p in (d / leaf).iterdir())
        downloaded = files(near)
        self.assertEqual(len(downloaded), 1)
        self.assertEqual(re.sub(br'X-TUID: .*\n', b'', downloaded[0].read_bytes()), message)
        # Native Maildir far transport assigns UID filenames and X-TUID.
        source = files(far / 'INBOX')[0]
        self.assertTrue(source.name.endswith(':2,S'))
        self.assertEqual(re.sub(br'X-TUID: .*\n', b'', source.read_bytes()), message)
        # Near flag/deletion changes and new near mail must never push.
        moved = downloaded[0].with_name(downloaded[0].name.split(':')[0] + ':2,FT')
        downloaded[0].rename(moved)
        # Far deletion flag is neither pulled nor expunged under this policy.
        flagged = source.with_name(source.name[:-1] + 'ST')
        source.rename(flagged)
        source = flagged
        (near / 'new/near-only').write_bytes(message.replace(b'fixture-1', b'near-only'))
        self.assertEqual(self.manual_sync().returncode, 0)
        self.assertEqual(files(far / 'INBOX'), [source])
        self.assertTrue(moved.exists())  # PullNew does not copy remote flag updates
        moved.unlink()
        self.assertEqual(self.manual_sync().returncode, 0)
        self.assertTrue(source.exists())  # near deletion not pushed/expunged
        # Remote deletion must not remove an already downloaded near message.
        source2 = far / 'INBOX/new/fixture-two'
        source2.write_bytes(message.replace(b'fixture-1', b'fixture-2'))
        self.assertEqual(self.manual_sync().returncode, 0)
        second = next(p for p in files(near) if b'fixture-2' in p.read_bytes())
        next(p for p in files(far / 'INBOX') if b'fixture-2' in p.read_bytes()).unlink()
        self.assertEqual(self.manual_sync().returncode, 0)
        self.assertTrue(second.exists())
        # Native child failure must propagate through the real wrapper.
        self.cfg.write_text(config.replace(str(far), str(self.root / 'missing-far')))
        self.assertNotEqual(self.manual_sync().returncode, 0)

    def test_integration_bundle_and_all_asset_drift(self):
        out = self.root / 'bundle'
        command = ['sh', str(ASSETS / 'build'), '--bundle', str(out)]
        p = self.run_cmd(command)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len((out / 'BUILD-RECEIPT').read_text().splitlines()), 3)
        self.assertTrue((out / 'bin/mw').exists())
        self.assertTrue((out / 'lib/mutt-wizard/openfile').exists())
        records = json.loads((ASSETS / 'runtime-provenance.json').read_text())['components']
        import hashlib
        for line in (out / 'BUILD-RECEIPT').read_text().splitlines():
            name, original, patch, output = line.split()
            record = records[name]
            self.assertEqual([original, patch, output], [record['original_sha256'], record['patch_sha256'], record['output_sha256']])
            file = out / ('lib/mutt-wizard/openfile' if name == 'openfile' else 'bin/' + name)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(), output)
        source = (out / 'bin/mw').read_text()
        lookup = source[source.index('parsedomains()'):source.index('delete()')]
        probe = 'muttshare=$1; fulladdr=fixture@gmail.com; ' + lookup + '\nparsedomains; printf "%s\\n" "$imap"'
        result = self.run_cmd(['/bin/ksh', '-c', probe, str(out / 'bin/mw'), str(out)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), b'imap.gmail.com')

        self.assertNotEqual(self.run_cmd(command).returncode, 0)
        # Deterministically fail the second link, after one successful link.
        # Publication must not expose even a partial fresh destination.
        failed = self.root / 'late-failure-bundle'
        count = self.root / 'ln-count'
        self.env['LN_COUNT'] = str(count)
        self.script('ln', '''n=0
[ ! -f "$LN_COUNT" ] || read -r n < "$LN_COUNT"
n=$((n + 1))
printf '%s\\n' "$n" > "$LN_COUNT"
[ "$n" -ne 2 ] || { echo injected-second-ln-failure >&2; exit 73; }
exec /bin/ln "$@"
''')
        retry = ['sh', str(ASSETS / 'build'), '--bundle', str(failed)]
        p = self.run_cmd(retry)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn(b'injected-second-ln-failure', p.stderr)
        self.assertEqual(count.read_text().strip(), '2')
        self.assertFalse(os.path.lexists(failed))
        self.assertFalse(list(self.root.glob('.mw-build.*')))
        (self.bin / 'ln').unlink()
        p = self.run_cmd(retry)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual((failed / 'BUILD-RECEIPT').read_bytes(),
                         (out / 'BUILD-RECEIPT').read_bytes())
        for rel in ('bin/mw', 'bin/mailsync', 'lib/mutt-wizard/openfile'):
            self.assertEqual((failed / rel).read_bytes(), (out / rel).read_bytes())
        self.assertFalse(list(self.root.glob('.mw-build.*')))
        # Tamper each asset in a private source copy; even a late-component
        # failure must leave the requested destination entirely absent.
        import shutil
        for name in ('local-imap.patch', 'mailsync.patch', 'openfile.patch'):
            copied = self.root / name.replace('.patch', '-assets')
            shutil.copytree(ASSETS, copied)
            (copied / name).write_text('drift\n')
            dest = self.root / name.replace('.patch', '-output')
            p = self.run_cmd(['sh', str(copied / 'build'), '--bundle', str(dest)])
            self.assertNotEqual(p.returncode, 0)
            self.assertFalse(dest.exists())

    def test_integration_mailto_desktop_contract(self):
        desktop = (REPO / '.local/share/applications/mail.desktop').read_text()
        self.assertIn('Exec=xdg-terminal-exec neomutt %u', desktop)
        self.assertIn('x-scheme-handler/mailto=mail.desktop;', (REPO / '.config/mimeapps.list').read_text())
        cwm = (REPO / '.config/cwm/cwmrc').read_text()
        self.assertRegex(cwm, r'bind-key 4-e\s+.*\$TERMINAL -e neomutt')
        capture = self.root / 'terminal-argv'
        terminal = self.bin / 'terminal-fixture'
        terminal.write_text('#!/usr/local/bin/python3\nimport json,sys\nfrom pathlib import Path\nPath(' + repr(str(capture)) + ').write_text(json.dumps(sys.argv[1:]))\n')
        terminal.chmod(0o700)
        self.env['TERMINAL'] = str(terminal)
        # Use the real canonical dependency too, without importing owner PATH.
        (self.bin / 'ifinstalled').symlink_to(REPO / '.local/bin/ifinstalled')
        url = 'mailto:target@example.invalid?subject=Hello%20%26%20world'
        p = self.run_cmd([str(REPO / '.local/bin/xdg-terminal-exec'), 'neomutt', url])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(capture.read_text()), ['-e', 'neomutt', url])

    def test_integration_mailcap_native_attachment(self):
        # Native attachment menu invokes the actual user helper at its eventual
        # user-lib path. Only xdg-open is stubbed; no desktop/browser launches.
        import shutil
        lib = self.home / '.local/lib/mutt-wizard'
        lib.mkdir(parents=True)
        shutil.copy2(self.bin / 'openfile', lib / 'openfile')
        self.script('vertrice-mail-openfile', 'exec "$HOME/.local/lib/mutt-wizard/openfile" "$@"\n')
        cap = self.home / '.config/mutt/mailcap'
        cap.parent.mkdir(parents=True)
        shutil.copy2(REPO / '.config/mutt/mailcap', cap)
        self.opener()
        inbox = self.home / 'inbox'
        for leaf in ('cur', 'new', 'tmp'):
            (inbox / leaf).mkdir(parents=True)
        (inbox / 'new/synthetic').write_text('From: synthetic@example.invalid\nTo: fixture@example.invalid\nSubject: attachment fixture\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="fixture"\n\n--fixture\nContent-Type: text/plain\n\nSynthetic only.\n--fixture\nContent-Type: video/mp4\nContent-Disposition: attachment; filename="space movie.mp4"\n\nSynthetic video, not playable.\n--fixture--\n')
        rc = cap.parent / 'muttrc'
        rc.write_text(f'set folder="{inbox}"\nset spoolfile="{inbox}"\nset mbox_type=Maildir\nset mailcap_path="{cap}"\nset mailcap_sanitize=yes\nset sendmail="/usr/bin/false"\n')
        env = dict(self.env, TERM='xterm', TMPDIR=str(self.root))
        tty(self, [], [(b'', b'attachment fixture'), (b'v', b'video/mp4'),
                       (b'jj', b'movie.mp4'), (b'm', b'')], env)
        target = self.wait_open()
        self.assertIn('movie', target.name)
        self.assertEqual(target.read_bytes().strip(), b'Synthetic video, not playable.')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('/usr/local/share/mutt-wizard/mailcap', rc.read_text())
        self.assertIn('html-to-text %s 1024 %{charset}', cap.read_text())


class Profile(legacy.Overlay):
    def test_integration_namespace_native_bound_passcmd(self):
        self.mail_policy()
        self.ok(self.runmw())
        self.ok(self.runmw(legacy.B))
        config=self.read('.mbsyncrc').decode()
        command=re.search(r'^PassCmd "(.*)"$',config,re.M).group(1)
        import shlex
        actual=shlex.split(next(x[8:] for x in config.splitlines() if x.startswith('PassCmd ')))[0]
        words=shlex.split(actual)
        self.assertEqual(words[-2:],[str(self.store),'mail/'+legacy.A])
        self.assertIn('PASSWORD_STORE_DIR="$1" pass show "$2"',words[2])
        capture=self.home/'native-pass-env'
        # Observe argv/environment, then execute native pass and native GPG.
        observer=self.home/'observe-bin'; observer.mkdir()
        front=observer/'pass'
        front.write_text('#!/bin/sh\n/usr/bin/env > "$CAPTURE"\nexec /usr/local/bin/pass "$@"\n')
        front.chmod(0o700)
        wrong=self.home/'wrong-store'; wrong.mkdir()
        for context in ('wrong','unset'):
            listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1); listener.settimeout(4)
            port=listener.getsockname()[1]; auth=[]; errors=[]
            def server():
                try:
                    conn,_=listener.accept()
                    with conn:
                        conn.settimeout(3)
                        conn.sendall(b'* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] fixture\r\n')
                        stream=conn.makefile('rb')
                        while True:
                            line=stream.readline()
                            if not line: break
                            parts=line.strip().split(); tag=parts[0]; action=parts[1].upper()
                            if action==b'CAPABILITY':
                                conn.sendall(b'* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n'+tag+b' OK fixture\r\n')
                            elif action==b'AUTHENTICATE':
                                if len(parts)>3: auth.append(base64.b64decode(parts[3]))
                                else:
                                    conn.sendall(b'+ \r\n'); auth.append(base64.b64decode(stream.readline().strip()))
                                conn.sendall(tag+b' NO synthetic authentication refusal\r\n')
                            elif action==b'LOGOUT':
                                conn.sendall(b'* BYE fixture\r\n'+tag+b' OK fixture\r\n'); break
                            else: conn.sendall(tag+b' BAD fixture\r\n')
                except (OSError,IndexError) as e: errors.append(repr(e))
                finally: listener.close()
            thread=threading.Thread(target=server,daemon=True); thread.start()
            # Transport is synthetic plaintext loopback only; the exact candidate
            # PassCmd is unchanged. No external name resolution or real account.
            cfg=self.home/('loopback-'+context)
            maildir=self.home/('loopback-maildir-'+context)
            for leaf in ('cur','new','tmp'): (maildir/leaf).mkdir(parents=True)
            cfg.write_text('IMAPAccount fixture\nHost 127.0.0.1\nPort '+str(port)+'\nUser fixture\nSSLType None\nAuthMechs PLAIN\nPassCmd "'+command+'"\n\n'
                           'IMAPStore remote\nAccount fixture\n\nMaildirStore local\nInbox '+str(maildir)+'\nSubFolders Verbatim\n\n'
                           'Channel fixture\nFar :remote:\nNear :local:\nSync Pull New\nCreate Near\nRemove None\nExpunge None\nSyncState *\n')
            env=dict(self.env,PATH=str(observer)+':/bin:/usr/bin:/usr/local/bin',CAPTURE=str(capture),
                     value='preexported-synthetic-value',first='preexported-synthetic-first')
            if context=='wrong': env['PASSWORD_STORE_DIR']=str(wrong)
            else: env.pop('PASSWORD_STORE_DIR',None)
            p=subprocess.run(['/usr/local/bin/mbsync','-c',str(cfg),'fixture'],
                             env=env,capture_output=True,timeout=8)
            thread.join(5)
            self.assertFalse(thread.is_alive())
            self.assertFalse(errors,errors)
            self.assertNotEqual(p.returncode,0)
            self.assertEqual(auth,[b'fixture\0fixture\0'+legacy.SECRET.encode()])
            child=dict(line.split('=',1) for line in capture.read_text().splitlines())
            self.assertEqual(child['PASSWORD_STORE_DIR'],str(self.store))
            self.assertNotIn('value',child); self.assertNotIn('first',child)
            self.assertNotIn(legacy.SECRET.encode(),p.stdout+p.stderr)
        self.assertFalse(list(wrong.iterdir()))
        self.assertEqual(self.before,self.git_snapshot())

    def test_integration_enrollment_default_switch_compose(self):
        self.ok(self.runmw())
        self.ok(self.runmw(legacy.B))
        # Actual installed native client, ordinary default discovery, no -n/-F,
        # no owner environment/config. Installed system path is /etc/mutt/Muttrc;
        # it is absent on this host (not copied from owner configuration).
        self.assertFalse(Path('/etc/mutt/Muttrc').exists())
        env = dict(self.env, PATH='/bin:/usr/bin:/usr/local/bin', TERM='xterm')
        shared = self.home / '.config/mutt/muttrc'
        self.assertIn('set mailcap_sanitize = yes', self.read('.config/mutt/accounts/' + legacy.A + '.muttrc').decode())
        self.assertNotIn('/usr/local/share/mutt-wizard/mailcap', shared.read_text())
        probe = ['-e', 'macro index X "<enter-command>set ?from<enter>"']
        transcript = tty(self, probe, [(b'', b'0 msgs'),
                          (b'X', legacy.A.encode()), (b'i2\r', b'Reading '),
                          (b'X', legacy.B.encode()), (b'i1\n', b'Reading '),
                          (b'X', legacy.A.encode())], env)
        self.assertNotIn(b'Mailbox is not open', transcript)
        url = 'mailto:target@example.invalid?subject=Hello%20%26%20world'
        transcript = tty(self, ['-e', 'set editor="/usr/bin/true" abort_unmodified=no', url],
                         [(b'', b'To: target@example.invalid'),
                          (b'\n', b'Subject: Hello & world'),
                          (b'\n', b'From:')], env)
        self.assertIn(legacy.A.encode(), transcript)
        self.assertIn(b'target@example.invalid', transcript)
        # A missing cache is not a missing mailbox. Block the configured
        # header-cache parent, load one synthetic message, and retain native
        # diagnostics rather than interpreting an empty screen as readiness.
        import shutil
        cache = self.home / '.cache/mutt-wizard'
        if cache.exists():
            shutil.rmtree(cache)
        cache.parent.mkdir(exist_ok=True)
        cache.write_text('synthetic cache blocker')
        inbox = self.home / '.local/share/mail' / legacy.A / 'INBOX'
        (inbox / 'new/cache-fixture').write_text('From: synthetic@example.invalid\nTo: fixture@example.invalid\nSubject: cache diagnostic fixture\n\nSynthetic only.\n')
        cache_transcript = tty(self, ['-d', '2', '-l', str(self.home / 'native-cache-log')],
                               [(b'', b'cache diagnostic fixture')], env)
        logs = b''.join(p.read_bytes() for p in self.home.glob('native-cache-log*'))
        self.assertIn(b'cache', logs.lower())
        self.assertTrue(b'not a directory' in logs.lower() or b'failed' in logs.lower() or b'error' in logs.lower(), logs.decode(errors='replace'))
        self.assertNotIn(b'Mailbox is not open', cache_transcript)
        # Deliberately break a local INBOX: native launch must report a real
        # missing-mailbox error, never be counted as an empty usable index.
        inbox = self.home / '.local/share/mail' / legacy.A / 'INBOX'
        inbox.rename(inbox.with_name('INBOX.saved'))
        transcript = tty(self, [], [(b'', b'Unknown Mailbox')], env)
        self.assertIn(b'Unable to open mailbox', transcript)
        self.assertIn(b'(no mailbox)', transcript)  # Msgs:0 alone is NOT readiness
        self.assertEqual(self.before, self.git_snapshot())

    def test_integration_postcommit_inbox_refusal_recovery(self):
        mail = self.home / '.local/share/mail'
        mail.parent.mkdir(parents=True)
        mail.mkdir()
        mail.chmod(0o777)
        result = self.runmw()
        self.failed(result)
        self.assertIn('INBOX initialization failed; not inbox-ready', result.stderr)
        self.assertTrue((self.pending / 'committed').exists())
        self.assertEqual(list(mail.iterdir()), [])
        self.assertTrue((self.home / '.config/mutt/accounts' / (legacy.A + '.muttrc')).exists())
        mail.chmod(0o700)  # repair only this fixture, then ordinary resume
        self.ok(self.runmw(legacy.B))
        for email in (legacy.A, legacy.B):
            for leaf in ('cur', 'new', 'tmp'):
                self.assertTrue((mail / email / 'INBOX' / leaf).is_dir())
        self.assertFalse(self.pending.exists())
        self.assertEqual(self.before, self.git_snapshot())


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(cls(name) for cls in (Plumbing, Profile)
                             for name in loader.getTestCaseNames(cls)
                             if name.startswith('test_integration_'))


if __name__ == '__main__':
    unittest.main()
