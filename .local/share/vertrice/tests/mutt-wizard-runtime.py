#!/usr/local/bin/python3
"""Source-only runtime qualification; disposable HOME, no owner state/network.

The only socket fixture binds IPv4 loopback; it never accepts authentication.
No real pass, GPG, credentials, message content, or desktop opener is used.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import unittest

REPO = Path(__file__).resolve().parents[4]
ASSETS = REPO / '.local/share/openbsd/mail/mutt-wizard'


class Runtime(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='mw-runtime.')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.home = self.root / 'home'
        self.home.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.env = {'HOME': str(self.home), 'PATH': f'{self.bin}:/bin:/usr/bin:/usr/local/bin',
                    'LC_ALL': 'C', 'XDG_CACHE_HOME': str(self.home / 'cache')}
        for component in ('mailsync', 'openfile'):
            p = self.run_cmd(['/bin/sh', str(ASSETS / 'runtime-build'), component,
                              str(self.bin / component)])
            self.assertEqual(p.returncode, 0, p.stderr)
        self.cfg = self.home / '.mbsyncrc'
        self.cfg.write_text('Channel alpha\n\nChannel beta@example.invalid\n')
        self.calls = self.root / 'calls'
        self.env['CALLS'] = str(self.calls)

    def run_cmd(self, argv, **kwargs):
        # Source build outputs are siblings of synthetic runtime HOME. Use the
        # private containing root only for build admission on HOME TMPDIR.
        env=self.env
        if len(argv)>1 and argv[1] in [str(ASSETS/'build'),str(ASSETS/'runtime-build')]:
            env=dict(self.env,HOME=str(self.root))
        return subprocess.run(argv, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=8, **kwargs)

    def script(self, name, text):
        p = self.bin / name
        p.write_text('#!/bin/sh\n' + text)
        p.chmod(0o700)
        return p

    def sync(self, *args):
        return self.run_cmd([str(self.bin / 'mailsync'), *args])

    def mock_sync(self):
        self.script('mbsync', 'printf "%s\\n" "$#|$1|$2|$3|${GPG_TTY-unset}" >> "$CALLS"\n'
                    '[ "$3" != "${FAIL_ACCOUNT-}" ]\n')

    def test_hashes_continuity_and_parsers(self):
        manifest = json.loads((ASSETS / 'runtime-provenance.json').read_text())
        for name in ('mailsync', 'openfile'):
            record = manifest['components'][name]
            output = self.bin / name
            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), record['output_sha256'])
            self.assertEqual(hashlib.sha256((ASSETS / (name + '.patch')).read_bytes()).hexdigest(),
                             record['patch_sha256'])
            for shell in ('/bin/sh', '/bin/ksh'):
                self.assertEqual(self.run_cmd([shell, '-n', str(output)]).returncode, 0)
        # Continuity: original operands select native channels, not a new service.
        self.mock_sync()
        self.assertEqual(self.sync('beta@example.invalid').returncode, 0)
        self.assertIn('|beta@example.invalid|unset', self.calls.read_text())

    def test_build_refuses_existing_symlink_drift_and_system_paths(self):
        build = ['/bin/sh', str(ASSETS / 'runtime-build'), 'mailsync']
        sentinel = self.root / 'sentinel'
        sentinel.write_text('unchanged')
        self.assertNotEqual(self.run_cmd(build + [str(sentinel)]).returncode, 0)
        self.assertEqual(sentinel.read_text(), 'unchanged')
        link = self.root / 'link'
        link.symlink_to(self.root / 'absent')
        self.assertNotEqual(self.run_cmd(build + [str(link)]).returncode, 0)
        for base in (sentinel, link):
            self.assertNotEqual(self.run_cmd(build + [str(self.root / 'new'), str(base)]).returncode, 0)
            self.assertFalse((self.root / 'new').exists())
        self.assertNotEqual(self.run_cmd(build + ['/usr/local/bin/fixture-never-write']).returncode, 0)
        self.assertNotEqual(self.run_cmd(build + ['relative']).returncode, 0)

    def test_all_one_partial_allfailure_and_no_state(self):
        self.mock_sync()
        self.assertEqual(self.sync().returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 2)
        for account in ('alpha', 'beta@example.invalid'):
            self.env['FAIL_ACCOUNT'] = account
            self.calls.unlink()
            self.assertNotEqual(self.sync().returncode, 0)
            self.assertEqual(len(self.calls.read_text().splitlines()), 2)
        self.script('mbsync', 'echo child >> "$CALLS"; exit 23\n')
        self.assertNotEqual(self.sync().returncode, 0)
        self.assertFalse((self.home / '.config/mutt/.mailsynclastrun').exists())

    def test_invalid_request_never_runs_child(self):
        self.mock_sync()
        for args in [('missing',), ('alpha', 'missing'), ('--all',), ('-a',),
                     ('alpha:INBOX',), ('*',), ('alpha,beta',), ('',), ('a;false',)]:
            self.assertNotEqual(self.sync(*args).returncode, 0, args)
            self.assertFalse(self.calls.exists())
        for text in ('', 'Channel alpha extra\n', 'Channel "alpha"\n',
                     'Channel -a\n', 'Channel alpha\nChannel alpha\n',
                     'Include fixture\nChannel alpha\n', '"Channel" alpha\n'):
            self.cfg.write_text(text)
            self.assertNotEqual(self.sync().returncode, 0, text)
            self.assertFalse(self.calls.exists())

    def test_groups_refused_and_operands_deduplicated(self):
        self.mock_sync()
        for group in ('Group alpha beta', '\t gRoUp\talpha\tbeta',
                      'Group alpha\nChannel beta', 'Group alpha\nChannels beta',
                      '"Group" alpha beta', "'Group' alpha beta", 'Gr"oup" alpha beta'):
            for args in ((), ('alpha',), ('alpha', 'beta')):
                self.cfg.write_text('Channel alpha\n\nChannel beta\n\n' + group + '\n')
                self.assertNotEqual(self.sync(*args).returncode, 0, (group, args))
                self.assertFalse(self.calls.exists())
        self.cfg.write_text('Channel alpha\n\nChannel beta\n')
        self.assertEqual(self.sync('alpha', 'beta', 'alpha', 'beta').returncode, 0)
        self.assertEqual(len(self.calls.read_text().splitlines()), 2)

    def test_open_executable_source_loses_execute_bits(self):
        self.opener()
        source = self.root / 'executable.txt'
        source.write_text('synthetic')
        source.chmod(0o700)
        p = self.run_cmd([str(self.bin / 'openfile'), str(source)])
        self.assertEqual(p.returncode, 0, p.stderr)
        target = self.wait_open()
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(source.stat().st_mode & 0o777, 0o700)

    def test_open_parent_trust(self):
        self.opener()
        parent = self.root / 'unsafe'
        parent.mkdir()
        source = parent / 'synthetic.txt'
        source.write_text('synthetic')
        for mode in (0o777, 0o770, 0o1777):
            parent.chmod(mode)
            self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(source)]).returncode, 0)
            self.assertFalse(self.calls.exists())
        parent.chmod(0o700)
        alias = self.root / 'alias'
        alias.symlink_to(parent, target_is_directory=True)
        self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(alias / source.name)]).returncode, 0)
        for mode in (0o777, 0o770):
            self.env['XDG_CACHE_HOME'] = str(parent)
            parent.chmod(mode)
            self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(self.cfg)]).returncode, 0)
            self.assertFalse(self.calls.exists())
        parent.chmod(0o700)
        source.chmod(0o660)
        self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(source)]).returncode, 0)
        self.assertFalse(self.calls.exists())
        source.chmod(0o600)
        self.env['XDG_CACHE_HOME'] = str(self.home / 'cache')
        # No privilege/chown: simulate foreign ownership only for these synthetic
        # paths. Actual filesystem owner checks are exercised for current UID.
        self.script('stat', f'''if [ "$3" = "$FOREIGN" ]; then
    case "$2" in
    '%u %Op') printf '{os.getuid() + 1} 40700\\n'; exit 0;;
    '%u') printf '{os.getuid() + 1}\\n'; exit 0;;
    esac
fi
exec /usr/bin/stat "$@"
''')
        (self.home / 'cache').mkdir(exist_ok=True)
        for foreign in (source, parent, self.home / 'cache'):
            self.env['FOREIGN'] = str(foreign)
            self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(source)]).returncode, 0)
            self.assertFalse(self.calls.exists())
        (self.bin / 'stat').unlink()
        source_link = self.root / 'source-link'
        source_link.symlink_to(source)
        for bad in (self.root / 'missing', self.home, source_link):
            self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(bad)]).returncode, 0)
        fifo = self.root / 'fifo'
        os.mkfifo(fifo)
        self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(fifo)]).returncode, 0)
        desktop = self.root / 'launch.DeSkToP'
        desktop.write_text('[Desktop Entry]\\nExec=false\\n')
        self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(desktop)]).returncode, 0)
        self.assertFalse(self.calls.exists())

    def test_open_handoff_status_and_wait(self):
        import time
        source = self.root / 'synthetic.txt'
        source.write_text('synthetic')
        # No opener exists anywhere on this private-only PATH.
        # Supply just the base utilities needed by the helper, not xdg-open.
        tools = self.root / 'tools'
        tools.mkdir()
        for name in ('id', 'stat', 'mkdir', 'mktemp', 'cp', 'chmod', 'rm', 'rmdir', 'printf'):
            for base in ('/bin', '/usr/bin'):
                path = Path(base) / name
                if path.exists():
                    (tools / name).symlink_to(path)
                    break
        self.env['PATH'] = str(tools)
        p = self.run_cmd([str(self.bin / 'openfile'), str(source)])
        self.assertNotEqual(p.returncode, 0)
        self.assertIn(b'handoff failed', p.stderr)
        self.assertTrue(list((self.home / 'cache').glob('*/synthetic.txt')))
        self.env['PATH'] = f'{self.bin}:/bin:/usr/bin:/usr/local/bin'
        self.script('xdg-open', 'exit 72\n')
        self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(source)]).returncode, 0)
        self.script('xdg-open', 'sleep 0.4\ncat "$1" > "$CALLS"\nexit 0\n')
        start = time.monotonic()
        p = self.run_cmd([str(self.bin / 'openfile'), str(source)])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertGreaterEqual(time.monotonic() - start, .35)
        self.assertEqual(self.calls.read_text(), 'synthetic')
        self.assertEqual(len(list((self.home / 'cache').glob('*/synthetic.txt'))), 3)

    def test_no_profile_notifications_index_or_message_scan(self):
        marker = self.root / 'unsafe'
        (self.home / '.profile').write_text(f'export MBSYNCRC=$(touch {marker})\n')
        for cmd in ('notify-send', 'osascript', 'notmuch', 'find', 'pgrep'):
            self.script(cmd, f'touch "{marker}"; exit 9\n')
        self.script('mbsync', 'echo synthetic-private-header; echo synthetic-secret >&2; exit 7\n')
        p = self.sync('alpha')
        self.assertNotEqual(p.returncode, 0)
        self.assertNotIn(b'synthetic-', p.stdout + p.stderr)
        self.assertFalse(marker.exists())

    def test_native_channel_parser_local_only(self):
        # Native parser/list with two empty disposable Maildirs. No remote store.
        for side in ('far', 'near'):
            for leaf in ('cur', 'new', 'tmp'):
                (self.root / side / leaf).mkdir(parents=True)
        self.cfg.write_text(f'''MaildirStore far
Inbox {self.root}/far
SubFolders Verbatim

MaildirStore near
Inbox {self.root}/near
SubFolders Verbatim

cHaNnEl alpha
Far :far:
Near :near:
Sync Pull New
Create Near
Remove None
Expunge None
SyncState *
''')
        p = self.run_cmd(['/usr/local/bin/mbsync', '-c', str(self.cfg), '-l', 'alpha'])
        self.assertEqual(p.returncode, 0, p.stderr)
        # Wrapper also recognizes the native case-insensitive directive spelling.
        self.mock_sync()
        self.assertEqual(self.sync('alpha').returncode, 0)

    def opener(self):
        self.script('xdg-open', 'sleep 0.15\nprintf "%s" "$1" > "$CALLS"\n')

    def wait_open(self):
        import time
        for _ in range(100):
            if self.calls.exists() and self.calls.stat().st_size:
                return Path(self.calls.read_text())
            time.sleep(.02)
        self.fail('stub opener not observed')

    def test_open_whitespace_unicode_dash_collision_retention(self):
        self.opener()
        for name in ('space attachment.html', '-leading.pdf', 'unicode-λ.txt'):
            source = self.root / name
            source.write_bytes(b'synthetic attachment only')
            copied = []
            for _ in range(2):
                if self.calls.exists():
                    self.calls.unlink()
                # Relative option-looking filenames are ordinary file operands.
                p = self.run_cmd([str(self.bin / 'openfile'), name], cwd=self.root)
                self.assertEqual(p.returncode, 0, p.stderr)
                target = self.wait_open()
                self.assertEqual(target.name, name)
                self.assertEqual(target.read_bytes(), source.read_bytes())
                self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                copied.append(target)
            self.assertNotEqual(*copied)
            self.assertTrue(all(p.exists() for p in copied))
            self.assertTrue(source.exists())

    def test_open_refuses_bad_cache_and_copy_failure(self):
        self.opener()
        source = self.root / 'synthetic.txt'
        source.write_text('synthetic')
        link = self.root / 'cache-link'
        link.symlink_to(self.home)
        for cache in (str(link), str(link / 'nested'), str(self.home / '../escape'), '/', 'relative'):
            self.env['XDG_CACHE_HOME'] = cache
            self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(source)]).returncode, 0)
        self.env['XDG_CACHE_HOME'] = str(self.home / 'cache')
        self.script('cp', 'exit 8\n')
        self.assertNotEqual(self.run_cmd([str(self.bin / 'openfile'), str(source)]).returncode, 0)
        self.assertFalse(self.calls.exists())
        self.assertEqual(list((self.home / 'cache').iterdir()), [])
        self.assertTrue(source.exists())

    def test_native_passcmd_failure_never_authenticates(self):
        # Native isync pclose behavior, not a successful mbsync stub. A deliberately
        # failing command can print misleading stdout, but must never authenticate.
        for mode in ('fail-output', 'fail-empty', 'empty', 'empty-firstline', 'metadata', 'native-fail-output'):
            with self.subTest(mode=mode):
                self.native_pass_case(mode)

    def native_pass_case(self, mode, generated_passcmd=None):
        # Fixed synthetic pass stub; no keyring or owner config is accessed.
        self.script('pass', {
            'fail-output': "printf 'synthetic-password\\n'; exit 19\n",
            'native-fail-output': "printf 'synthetic-password\\n'; exit 19\n",
            'fail-empty': 'exit 19\n',
            'empty': 'exit 0\n',
            'empty-firstline': "printf '\\nfixture-metadata\\n'\n",
            'metadata': "printf 'synthetic-password\\nfixture-metadata\\n'\n",
        }[mode])
        # Candidate generator idiom, NOT an edit to the concurrently-owned mw
        # patch. Check pass status before selecting a first line. OpenBSD sh uses
        # external printf; synthetic-only fixture, not an argv-isolation claim.
        password_command = self.script('fixture-passcmd', '''set +x
value=$(pass show fixture@example.invalid) || exit 1
first=${value%%'
'*}
[ -n "$first" ] || exit 1
printf '%s\\n' "$first"
unset value first
''')
        if generated_passcmd is not None:
            # Integration feeds the exact generated (isync-escaped) command.
            password_command = generated_passcmd
        if mode == 'native-fail-output':
            # Bypass the checked idiom to establish native pclose failure too.
            password_command = self.bin / 'pass'
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        listener.settimeout(4)
        port = listener.getsockname()[1]
        auth = []
        errors = []

        def server():
            try:
                conn, _ = listener.accept()
                with conn:
                    conn.settimeout(3)
                    conn.sendall(b'* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] fixture\r\n')
                    stream = conn.makefile('rb')
                    while True:
                        line = stream.readline()
                        if not line:
                            break
                        parts = line.strip().split()
                        tag = parts[0]
                        command = parts[1].upper()
                        if command == b'CAPABILITY':
                            conn.sendall(b'* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n' + tag + b' OK fixture\r\n')
                        elif command == b'AUTHENTICATE':
                            if len(parts) > 3:
                                auth.append(base64.b64decode(parts[3]))
                            else:
                                conn.sendall(b'+ \r\n')
                                auth.append(base64.b64decode(stream.readline().strip()))
                            conn.sendall(tag + b' NO fixture authentication refused\r\n')
                        elif command == b'LOGOUT':
                            conn.sendall(b'* BYE fixture\r\n' + tag + b' OK fixture\r\n')
                            break
                        else:
                            conn.sendall(tag + b' BAD fixture\r\n')
            except (OSError, IndexError) as e:
                errors.append(type(e).__name__)
            finally:
                listener.close()

        thread = threading.Thread(target=server, daemon=True)
        thread.start()
        maildir = self.root / ('maildir-' + mode)
        for leaf in ('cur', 'new', 'tmp'):
            (maildir / leaf).mkdir(parents=True)
        self.cfg.write_text(f'''IMAPAccount fixture
Host 127.0.0.1
Port {port}
User fixture
SSLType None
AuthMechs PLAIN
PassCmd "{password_command}"

IMAPStore remote
Account fixture

MaildirStore local
Inbox {maildir}
SubFolders Verbatim

Channel fixture
Far :remote:
Near :local:
Sync Pull New
Create Near
Remove None
Expunge None
SyncState *
''')
        # No mbsync stub exists in this fixture: exercise the patched wrapper's
        # full native PassCmd failure chain, including its nonzero final status.
        p = self.sync('fixture')
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(errors, errors)
        self.assertNotEqual(p.returncode, 0)
        if mode == 'metadata':
            self.assertEqual(auth, [b'fixture\x00fixture\x00synthetic-password'])
        else:
            self.assertEqual(auth, [])
        self.assertNotIn(b'synthetic-password', p.stdout + p.stderr)
        self.assertNotIn(b'fixture-metadata', p.stdout + p.stderr)


if __name__ == '__main__':
    unittest.main()
