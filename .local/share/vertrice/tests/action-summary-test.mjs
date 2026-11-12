import assert from 'node:assert/strict';
import { operationLabel as label, summaryInput } from '../../../../.pi/agent/action-summary.mjs';
for (const [command, expected] of [
  ['git fetch', 'git fetch'], ['git --git-dir /secret fetch', 'git fetch'],
  ['git --git-dir=/secret --no-pager status', 'git status'],
  ['cd /secret && printf "git push"; git fetch', 'git fetch'],
  ['git log | grep private', 'git log → grep'],
  ['git fetch; git diff', 'git fetch → git diff'],
  ['printf "git push"; node "git fetch"', 'node'],
  ["printf '$(git push)'; git status", 'git status'],
  ['node "$(git push)"', 'script'], ['git status > /secret', 'script'],
  ['(git fetch)', 'script'], ['if true; then git fetch; fi', 'script'],
  ['git fetch &&', 'script'], ['git "fetch', 'script'], ['', 'script'],
  ['git --git-dir', 'script'], ['git fetch &', 'script'],
  ['git fetch `git push`', 'script'], ['"git" fetch', 'script'],
]) assert.equal(label(command), expected, command);
assert.equal(summaryInput('bash', {command:'git --git-dir /credential fetch private-token'}), 'Tool: bash; operations: git fetch');
assert.equal(summaryInput('bash', {command:'git fetch other-secret'}), summaryInput('bash', {command:'git fetch private-token'}));
assert.equal(summaryInput('unknown', {}), undefined);
console.log('PASS operation subset, quoting, unsupported/malformed fallback and metadata privacy');
