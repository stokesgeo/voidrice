#!/usr/bin/env python3
"""Membership/command safety tests; no real windows or services."""
from importlib.machinery import SourceFileLoader
import importlib.util
from pathlib import Path
import shlex
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[4] / '.config' / 'aerospace'
spec = importlib.util.spec_from_loader('master', SourceFileLoader('master', str(ROOT / 'master-layout')))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def rows(*ids):
    return [{'id': n, 'layout': 'h_tiles', 'fullscreen': False} for n in ids]


class SafetyTests(unittest.TestCase):
    def test_launch_commands_are_standalone_binding_elements(self):
        config = tomllib.loads((ROOT / 'aerospace.toml').read_text())
        bindings = config['mode']['main']['binding']
        for key in ['cmd-alt-ctrl-t', 'cmd-alt-ctrl-space', 'cmd-alt-ctrl-f', 'cmd-alt-ctrl-shift-u']:
            self.assertIsInstance(bindings[key], list)
            self.assertTrue(bindings[key][1].startswith('exec-and-forget '))
        for value in bindings.values():
            for command in value if isinstance(value, list) else [value]:
                if 'exec-and-forget' in command:
                    self.assertTrue(command.startswith('exec-and-forget '))

    def test_unchanged_membership_does_not_rebuild(self):
        self.assertIsNone(m.selection(rows(1, 2, 3), {'ids': [1, 2, 3], 'master': 2}))

    def test_force_repairs_same_membership(self):
        self.assertEqual(m.selection(rows(1, 2), {'ids': [1, 2], 'master': 2}, True)['master'], 2)

    def test_floating_hidden_and_minimized_do_not_tile(self):
        extra = [{'id': i, 'layout': kind, 'fullscreen': False} for i, kind in
                 [(2, 'floating'), (3, 'macos_native_window_of_hidden_app'), (4, 'macos_native_window_of_minimized_app')]]
        self.assertEqual(m.selection(rows(1) + extra, {})['ids'], [1])

    def test_fullscreen_prevents_any_rebuild(self):
        for kind, flag in [('h_tiles', True), ('macos_native_fullscreen', False)]:
            self.assertIsNone(m.selection([{'id': 1, 'layout': kind, 'fullscreen': flag}], {}, True))

    def test_surviving_master_retained_on_new_window(self):
        self.assertEqual(m.selection(rows(1, 2, 9), {'ids': [1, 2], 'master': 2})['master'], 2)

    def test_closed_master_promotes_survivor(self):
        self.assertEqual(m.selection(rows(4, 8), {'ids': [1, 4, 8], 'master': 1})['master'], 4)

    def test_empty_membership_emits_no_commands(self):
        self.assertEqual(m.commands('test', m.selection([], {})), [])

    def test_two_windows_only_have_horizontal_halves(self):
        commands = m.commands('test', {'ids': [1, 2], 'master': 1})
        self.assertIn('layout --workspace test --root h_tiles', commands)
        self.assertFalse(any(c.startswith('join-with') for c in commands))
        self.assertEqual(commands[-1], 'balance-sizes --workspace test')

    def test_three_windows_join_only_stack(self):
        commands = m.commands('test', {'ids': [1, 2, 3], 'master': 1})
        self.assertEqual([c for c in commands if c.startswith('join-with')], ['join-with --window-id 2 right'])

    def test_five_windows_enter_same_stack(self):
        commands = m.commands('test', {'ids': [1, 2, 3, 4, 5], 'master': 1})
        join = commands.index('join-with --window-id 2 right')
        self.assertTrue(commands[join + 1].startswith('move --window-id 4 '))
        self.assertTrue(commands[join + 2].startswith('move --window-id 5 '))
        self.assertFalse(any(c.startswith(('focus ', 'close', 'fullscreen', 'workspace ')) for c in commands))

    def test_metadata_refuses_duplicates_and_malformed_flags(self):
        for value in ['1\th_tiles\ttrue\n1\th_tiles\tfalse', '0\th_tiles\tfalse', '1\th_tiles\t0', 'PRIVATE TITLE']:
            with self.assertRaises(RuntimeError):
                m.parse_rows(value)

    def test_workspace_is_one_quoted_argument(self):
        workspace = "work space; focus left"
        command = m.commands(workspace, {'ids': [1], 'master': 1})[0]
        self.assertEqual(shlex.split(command), ['flatten-workspace-tree', '--workspace', workspace])


if __name__ == '__main__':
    unittest.main()
