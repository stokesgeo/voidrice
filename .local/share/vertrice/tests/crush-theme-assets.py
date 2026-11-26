import json
from pathlib import Path
import re
import os
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[4]
fields = {
    'primary', 'secondary', 'accent', 'keyword',
    'fg_base', 'fg_subtle', 'fg_more_subtle', 'fg_most_subtle',
    'bg_base', 'bg_most_visible', 'bg_less_visible', 'bg_least_visible',
    'on_primary', 'separator', 'destructive', 'error', 'warning',
    'warning_subtle', 'attention', 'busy', 'info', 'info_more_subtle',
    'info_most_subtle', 'success', 'success_more_subtle', 'success_most_subtle',
    'diff_insert_fg', 'diff_insert_code_bg', 'diff_insert_gutter_bg',
    'diff_delete_fg', 'diff_delete_code_bg', 'diff_delete_gutter_bg',
    'yolo', 'plan', 'plan_more_subtle', 'button', 'button_subtle',
    'button_inactive', 'button_hovered',
}
colors = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
fields.update('ansi_' + color for color in colors)
fields.update('ansi_bright_' + color for color in colors)

def luminance(value):
    channels = [int(value[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels]
    return sum(value * weight for value, weight in zip(linear, (.2126, .7152, .0722)))

def contrast(first, second):
    low, high = sorted((luminance(first), luminance(second)))
    return (high + .05) / (low + .05)

for mode in ('day', 'night'):
    palette = json.loads((root / '.config/crush/themes' / ('vertrice-' + mode + '.json')).read_text())
    assert set(palette) == fields | {'base'}, (mode, 'incomplete palette')
    assert palette['base'] == 'charmtone-panther'
    assert all(re.fullmatch('#[0-9a-f]{6}', palette[field]) for field in fields)
    backgrounds = ['bg_base', 'bg_less_visible', 'bg_least_visible']
    for foreground in ['fg_base', 'fg_subtle', 'fg_more_subtle', 'fg_most_subtle']:
        for background in backgrounds:
            assert contrast(palette[foreground], palette[background]) >= 4.5, (mode, foreground, background)
    for field in fields:
        if field.startswith('ansi_'):
            assert contrast(palette[field], palette['bg_base']) >= 4.5, (mode, field)
    for foreground, background in [
        ('fg_base', 'button_subtle'), ('fg_base', 'button_inactive'),
        ('on_primary', 'button'), ('on_primary', 'button_hovered'),
        ('on_primary', 'secondary'), ('on_primary', 'error'),
        ('on_primary', 'info'), ('diff_insert_fg', 'diff_insert_code_bg'),
        ('diff_delete_fg', 'diff_delete_code_bg'),
    ]:
        assert contrast(palette[foreground], palette[background]) >= 4.5, (mode, foreground, background)
    for foreground in ['fg_base', 'on_primary', 'warning_subtle']:
        assert contrast(palette[foreground], palette['primary']) >= 3, (mode, foreground, 'primary')
    for background in backgrounds:
        assert (luminance(palette[background]) > .7) == (mode == 'day'), (mode, background)
    print('PASS complete Crush', mode, 'palette and contrast contracts')

wrapper = root / '.local/bin/openbsd/crush-terminal'
subprocess.run(['/bin/ksh', '-n', str(wrapper)], check=True)
with tempfile.TemporaryDirectory(prefix='crush-theme-assets-') as scratch:
    base = Path(scratch)
    mock = base / 'xterm'
    mock.write_text(
        '#!' + sys.executable + '\n'
        'import json, os, sys\n'
        'from pathlib import Path\n'
        'Path(os.environ["ARGV_LOG"]).write_text(json.dumps(sys.argv[1:]))\n'
        'sys.exit(int(os.environ["MOCK_STATUS"]))\n'
    )
    mock.chmod(0o755)
    cases = [
        [],
        [''],
        ['--cwd', 'space dir'],
        ['$(touch injected)', '; touch injected', '*', '$HOME', '`touch injected`',
         'a\nb', '"quoted"', "'single'", '\\', '', '--'],
    ]
    for status in (0, 23):
        for args in cases:
            log = base / 'argv.json'
            result = subprocess.run(
                [str(wrapper), *args], cwd=base, timeout=10,
                env={'PATH': scratch, 'ARGV_LOG': str(log), 'MOCK_STATUS': str(status)},
            )
            assert result.returncode == status, (args, result.returncode)
            assert json.loads(log.read_text()) == ['-e', 'crush', *args], args
            assert not (base / 'injected').exists()
print('PASS actual launcher syntax, PATH command vector, empty/spaced/metacharacter argv and exit status')
