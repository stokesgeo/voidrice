import argparse
import errno
import fcntl
import http.server
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import threading
import time


SOURCE = Path(__file__).resolve().parents[4]


def require(value, detail):
    if not value:
        raise AssertionError(detail)


class Terminal:
    def __init__(self, command, env):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 44, 150, 0, 0))
        self.pid = os.fork()
        if self.pid == 0:
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            for fd in (0, 1, 2):
                os.dup2(slave, fd)
            os.close(self.master)
            if slave > 2:
                os.close(slave)
            os.execve(command[0], command, env)
        os.close(slave)
        self.raw = bytearray()

    def pump(self, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if not select.select([self.master], [], [], .05)[0]:
                continue
            try:
                data = os.read(self.master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    return
                raise
            if not data:
                return
            self.raw.extend(data)
            require(len(self.raw) < 8000000, 'PTY output exceeded bound')
            if b'\x1b[6n' in data:
                self.send(b'\x1b[1;1R')
            if b'\x1b]11;?' in data:
                self.send(b'\x1b]11;rgb:0000/0000/0000\x1b\\')

    def send(self, data):
        os.write(self.master, data)

    def text(self):
        return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', self.raw.decode(errors='replace'))

    def statuses(self):
        return re.findall(rb'\x1b\]7501;state=([^\x07\x1b]*)(?:\x07|\x1b\\)', self.raw)

    def close(self):
        try:
            os.killpg(self.pid, signal.SIGTERM)
            self.pump(.3)
        finally:
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(self.pid, 0)
            os.close(self.master)


class Provider(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reject(self):
        self.server.blocked += 1
        try:
            self.send_error(403)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_CONNECT(self):
        self.reject()

    def do_GET(self):
        self.reject()

    def do_POST(self):
        if self.path != '/v1/chat/completions':
            self.server.unexpected.append(self.path)
            self.send_error(403)
            return
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length < 4000000:
            self.send_error(413)
            return
        request = json.loads(self.rfile.read(length))
        self.server.records.append(request)
        tool = None
        if request['model'] == 'fixture-main':
            self.server.steps += 1
            step = self.server.steps
            if step <= len(self.server.sequence):
                name, args = self.server.sequence[step - 1]
                tool = {'index': 0, 'id': 'probe_' + str(step), 'type': 'function',
                        'function': {'name': name, 'arguments': json.dumps(args)}}
        delta = {'tool_calls': [tool]} if tool else {'content': 'FIXTURE_COMPLETE'}
        chunk = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1700000000,
                 'model': request['model'], 'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]}
        end = dict(chunk, choices=[{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if tool else 'stop'}])
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        try:
            for item in (chunk, end):
                self.wfile.write(('data: ' + json.dumps(item) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser(description='Run clean-HOME native Crush acceptance probes without real authentication.')
    parser.add_argument('executable', nargs='?', default='/usr/local/bin/crush',
                        help='absolute native executable path (default: /usr/local/bin/crush)')
    args = parser.parse_args()
    binary = Path(args.executable)
    if not binary.is_absolute() or not binary.is_file() or not os.access(binary, os.X_OK):
        parser.error('executable must be an absolute path to an executable file')
    binary = str(binary)
    os.umask(0o077)
    guide = (SOURCE / '.config/crush/CRUSH.md').read_text()
    skill = (SOURCE / '.config/crush/skills/coding-workflow/SKILL.md').read_text()
    config = (SOURCE / '.config/crush/crushrc').read_text()
    require(len(guide.splitlines()) < 25 and 'OpenBSD' in guide, 'guide shape')
    require(len(skill.splitlines()) < 35 and 'user-invocable: true' in skill, 'skill shape')
    require('permissions allow view ls glob grep' in config, 'candidate read grants')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    server.daemon_threads = True
    server.records, server.unexpected, server.steps, server.blocked = [], [], 0, 0
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    try:
        with tempfile.TemporaryDirectory(prefix='crush-portable-') as temporary:
            root = Path(temporary)
            home = root / 'home'
            work = home / 'workspace'
            for directory in ('home', 'home/workspace', 'config/crush', 'data', 'cache', 'state', 'runtime', 'tmp'):
                (root / directory).mkdir(parents=True, exist_ok=True)
            shutil.copytree(SOURCE / '.config/crush', root / 'config/crush', dirs_exist_ok=True)
            env = {'HOME': str(home), 'PATH': '/usr/local/bin:/usr/bin:/bin', 'TERM': 'xterm-256color',
                   'LANG': 'C.UTF-8', 'TMPDIR': str(root / 'tmp'),
                   'CRUSH_GLOBAL_CONFIG': str(root / 'config/crush'), 'CRUSH_GLOBAL_DATA': str(root / 'data/crush'),
                   'CRUSH_SKILLS_DIR': str(root / 'config/crush/skills'), 'CRUSH_CACHE_DIR': str(root / 'cache/crush'),
                   'CRUSH_DISABLE_METRICS': 'true', 'CRUSH_DISABLE_PROVIDER_AUTO_UPDATE': 'true',
                   'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
                   'XDG_CACHE_HOME': str(root / 'cache'), 'XDG_STATE_HOME': str(root / 'state'),
                   'XDG_RUNTIME_DIR': str(root / 'runtime')}
            proxy = 'http://127.0.0.1:' + str(server.server_address[1])
            for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
                env[key] = proxy
            env['NO_PROXY'] = env['no_proxy'] = '127.0.0.1,localhost'
            version = subprocess.run([binary, '--version'], env=env, capture_output=True, timeout=5, check=True).stdout.decode().strip()
            command = [binary, '--cwd', str(work), '--data-dir', str(root / 'project-data')]
            terminal = Terminal(command, env)
            try:
                terminal.pump(5)
                text = terminal.text()
                require(any(word in text.lower() for word in ('choose a provider', 'select a provider', 'welcome', 'get started')),
                        'native onboarding not observed: ' + text[-5000:])
                require(not server.records, 'unexpected native model request')
                print('PASS native no-auth first-run onboarding', flush=True)
            finally:
                terminal.close()
            sample = root / 'outside/sample.txt'
            sample.parent.mkdir()
            sample.write_text('SYNTHETIC_BEFORE\n')
            shell = root / 'outside/shell.txt'
            loaded_skill = root / 'config/crush/skills/coding-workflow/SKILL.md'
            server.sequence = [
                ('view', {'file_path': str(loaded_skill)}),
                ('view', {'file_path': str(sample)}),
                ('ls', {'path': str(sample.parent)}),
                ('glob', {'path': str(sample.parent), 'pattern': '*.txt'}),
                ('grep', {'path': str(sample.parent), 'pattern': 'SYNTHETIC_BEFORE'}),
                ('bash', {'command': 'echo SYNTHETIC_EXECUTED', 'description': 'Safe synthetic execution'}),
                ('edit', {'file_path': str(sample), 'old_string': 'SYNTHETIC_BEFORE', 'new_string': 'FORBIDDEN'}),
                ('bash', {'command': 'printf FORBIDDEN > ' + str(shell), 'description': 'Synthetic approval denial probe'})]
            cfg = {'providers': {'fixture': {'type': 'openai-compat', 'name': 'Local synthetic fixture',
                   'base_url': proxy + '/v1', 'api_key': 'SYNTHETIC-NOT-A-SECRET',
                   'models': [{'id': name, 'name': name, 'context_window': 32000, 'default_max_tokens': 1024}
                              for name in ('fixture-main', 'fixture-small')]}},
                   'models': {slot: {'provider': 'fixture', 'model': name} for slot, name in
                              (('large', 'fixture-main'), ('small', 'fixture-small'))},
                   'options': {'disable_default_providers': True, 'disable_metrics': True,
                               'disable_provider_auto_update': True, 'auto_lsp': False}}
            (work / 'crush.json').write_text(json.dumps(cfg))
            terminal = Terminal(command, env)
            thread.start()
            denied = []
            awaiting_end = False
            status_cursor = 0
            denial_sent_at = 0
            denial_attempts = {}
            try:
                terminal.pump(4)
                if 'initialize this project' in terminal.text().lower():
                    terminal.send(b'n')
                    terminal.pump(1)
                terminal.raw.clear()
                terminal.send(b'Synthetic fixture only. Read coding-workflow and run the probes.\r')
                deadline = time.monotonic() + 50
                while time.monotonic() < deadline:
                    terminal.pump(.1)
                    step = server.steps
                    statuses = terminal.statuses()
                    fresh = statuses[status_cursor:]
                    if awaiting_end:
                        if any(status.split(b':', 1)[0] in (b'done', b'idle', b'error') for status in fresh):
                            terminal.send(b'Continue synthetic fixture with the next probe\r')
                            awaiting_end = False
                            status_cursor = len(statuses)
                        elif not fresh and time.monotonic() - denial_sent_at >= .6:
                            require(denial_attempts[denied[-1]] < 5, ('denial not acknowledged', denied[-1]))
                            terminal.send(b'd')
                            denial_attempts[denied[-1]] += 1
                            denial_sent_at = time.monotonic()
                    elif step in (7, 8) and step not in denied and any(
                            status.startswith(b'blocked:kind=permission:') for status in fresh) and (
                            'enter confirm' in terminal.text().rsplit('Permission Required', 1)[-1]):
                        terminal.send(b'd')
                        denied.append(step)
                        awaiting_end = True
                        denial_sent_at = time.monotonic()
                        denial_attempts[step] = 1
                        status_cursor = len(statuses)
                    if server.steps >= 9:
                        break
                terminal.pump(.5)
                primary = [r for r in server.records if r['model'] == 'fixture-main']
                require(server.steps == 9, ('sequence incomplete', server.steps, denied, terminal.statuses(), terminal.text()[-5000:]))
                require(denied == [7, 8], ('denials', denied))
                names = {t['function']['name'] for t in primary[0]['tools']}
                require({'view', 'ls', 'glob', 'grep', 'bash', 'edit'} <= names, ('tool discovery', names))
                messages = json.dumps(primary[0]['messages'])
                require(guide in '\n'.join(str(m.get('content', '')) for m in primary[0]['messages']), 'guide not loaded')
                require('coding-workflow' in messages and 'Choose a scoped change' in messages, 'skill not discovered')
                results = [m for r in primary for m in r['messages'] if m.get('role') == 'tool']
                encoded = json.dumps(results)
                by_id = {m.get('tool_call_id'): str(m.get('content', '')) for m in results}
                require('name: coding-workflow' in by_id.get('probe_1', '') and
                        'Build a thin working slice' in by_id.get('probe_1', ''), 'skill read not executed')
                require('SYNTHETIC_BEFORE' in by_id.get('probe_2', ''), 'view did not execute')
                for number in (3, 4, 5):
                    require('sample.txt' in by_id.get('probe_' + str(number), ''), ('read tool result missing', number))
                require('SYNTHETIC_EXECUTED' in encoded, 'safe shell execution not observed')
                require(by_id.get('probe_7') == 'User denied permission', 'edit denial result missing')
                require(by_id.get('probe_8') == 'User denied permission', 'shell denial result missing')
                require(sample.read_text() == 'SYNTHETIC_BEFORE\n' and not shell.exists(), 'denied operation mutated state')
                require(not server.unexpected, ('unexpected network paths', server.unexpected))
                print('PASS candidate config, guide context, skill discovery/read, read grants, shell execution, PTY edit/bash denial')
                print('Denial key attempts by probe:', denial_attempts)
                print(version)
                print('Intercepted and rejected non-provider proxy attempts:', server.blocked)
                print('LIMIT current binary only; no provisioning, live authentication, real provider or OS network sandbox tested')
            finally:
                terminal.close()
    finally:
        if thread.is_alive():
            server.shutdown()
            thread.join(timeout=2)
        server.server_close()


if __name__ == '__main__':
    main()
