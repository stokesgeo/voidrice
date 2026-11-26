import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[4]


def git(directory, *args, data=None, env=None):
    return subprocess.run(
        ['git', '-C', str(directory), *args], input=data,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, env=env,
    ).stdout


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('GIT_')}
    paths = {os.fsdecode(path) for path in git(
        ROOT, 'ls-files', '-co', '--exclude-standard', '-z', env=env,
    ).split(b'\0') if path}
    paths = {path for path in paths
             if (ROOT / path).is_file() or (ROOT / path).is_symlink()}
    require(paths, 'no candidate files')
    with tempfile.TemporaryDirectory(prefix='vertrice-selection-') as scratch:
        repo = Path(scratch)
        git(repo, 'init', '-q', env=env)
        empty = git(repo, 'hash-object', '-w', '--stdin', data=b'', env=env).strip()
        records = b''.join(b'100644 ' + empty + b'\t' + os.fsencode(path) + b'\0'
                           for path in sorted(paths))
        git(repo, 'update-index', '-z', '--index-info', data=records, env=env)
        selected = {}
        for name, manifest in (
            ('openbsd', '.local/share/openbsd/sparse-checkout'),
            ('mac', '.local/share/darwin/sparse-checkout'),
            ('repo', '.local/share/vertrice/repo-only'),
        ):
            git(repo, 'sparse-checkout', 'set', '--no-cone', '--stdin',
                data=(ROOT / manifest).read_bytes(), env=env)
            selected[name] = {os.fsdecode(record[2:]) for record in git(
                repo, 'ls-files', '-t', '-z', env=env,
            ).split(b'\0') if record.startswith(b'H ')}
    require(paths == set.union(*selected.values()),
            'unclassified: ' + repr(sorted(paths - set.union(*selected.values()))))
    for machine in ('openbsd', 'mac'):
        require(not selected[machine] & selected['repo'],
                machine + ' installs repo-only: ' +
                repr(sorted(selected[machine] & selected['repo'])))
    require(not any(path.startswith(('.local/share/openbsd/', '.local/bin/openbsd/'))
                    for path in selected['mac']), 'Mac installs OpenBSD assets')
    manifest = json.loads((ROOT / '.pi/agent/resources.json').read_text())
    runtime = {'.pi/agent/' + entry['path'] for entry in manifest['files']}
    source = {'.pi/agent/' + path for path in manifest['sourceOnly']}
    require(not runtime & source, 'Pi runtime and sourceOnly overlap')
    for path in runtime | source:
        require(path in paths, 'Pi manifest file missing from candidate: ' + path)
        require('..' not in PurePosixPath(path).parts, 'invalid Pi path: ' + path)
    require(runtime <= selected['openbsd'],
            'Pi runtime excluded: ' + repr(sorted(runtime - selected['openbsd'])))
    require(source <= selected['repo'],
            'Pi sourceOnly not repo-only: ' + repr(sorted(source - selected['repo'])))
    require(not source & (selected['openbsd'] | selected['mac']),
            'Pi sourceOnly installed')
    require({path for path in paths if path.startswith('.pi/agent/')} ==
            runtime | source | {'.pi/agent/resources.json'},
            'Pi files do not match explicit resource manifest')
    for path in paths:
        if path.startswith(('.local/share/openbsd/pi/acquire/',
                            '.local/share/openbsd/pi/portable/')):
            target = 'repo' if path in {
                '.local/share/openbsd/pi/portable/test.mjs',
                '.local/share/openbsd/pi/portable/admission-test.mjs',
                '.local/share/openbsd/pi/acquire/test.mjs',
            } or path.startswith((
                '.local/share/openbsd/pi/portable/messenger/tests/',
                '.local/share/openbsd/pi/portable/tests/',
            )) else 'openbsd'
            require(path in selected[target], 'Pi build asset misclassified: ' + path)
        if path.startswith('.local/share/openbsd/crush/'):
            require(path in selected['openbsd'], 'native build asset excluded: ' + path)
        if path.startswith('.local/share/openbsd/mail/mutt-wizard/'):
            require(path in selected['openbsd'], 'mail build/license asset excluded: ' + path)
        if path.startswith('.config/crush/'):
            require(path in selected['openbsd'],
                    'Crush resource excluded from OpenBSD: ' + path)
        if path.startswith('.local/share/vertrice/tests/') or path == 'AGENTS.md':
            require(path in selected['repo'], 'developer file not repo-only: ' + path)
    print('PASS candidate selection: {} actual files, {} Pi runtime, {} sourceOnly'.format(
        len(paths), len(runtime), len(source)))


if __name__ == '__main__':
    main()
