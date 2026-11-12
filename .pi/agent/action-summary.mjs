// Deliberately lossy metadata. Never send shell arguments, paths or output.
const tools = new Set(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls', 'work_task', 'context_search', 'context_read']);
const gitOps = new Set(['fetch', 'status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'rev-list', 'ls-remote', 'config', 'add', 'commit', 'push', 'merge', 'checkout', 'switch']);
const programs = new Set(['git', 'node', 'pi', 'make', 'cc', 'ksh', 'ssh', 'ssh-add', 'ssh-keygen', 'ls', 'find', 'rg', 'grep', 'cp', 'mkdir']);
const incidental = new Set(['cd', 'printf', 'test', ':', 'true', 'false']);
const reserved = new Set(['if', 'then', 'else', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'in', '!']);

// A deliberately small shell subset, not a shell parser. Unsupported grammar
// invalidates the whole description; no input is ever evaluated or executed.
export function operationLabel(command) {
  if (typeof command !== 'string' || command.length > 65536) return 'script';
  const commands = [];
  let words = [], word = '', started = false, quoted = false, quote = '', needCommand = false;
  const flush = () => {
    if (started) words.push({ text: word, quoted });
    word = ''; started = false; quoted = false;
  };
  const end = () => { flush(); if (words.length) { commands.push(words); words = []; return true; } return false; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) { quote = ''; continue; }
      if (quote === '"' && (c === '$' || c === '`' || c === '\\')) return 'script';
      word += c; continue;
    }
    if (c === "'" || c === '"') { quote = c; quoted = true; started = true; continue; }
    if ('\\$`(){}<>'.includes(c) || c === '\u0000') return 'script';
    if (c === '#' && !started) return 'script';
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      const double = command[i + 1] === c;
      if (c === '&' && !double) return 'script';
      if (c === ';' && double) return 'script';
      const had = end();
      if (!had && (needCommand || c !== '\n')) return 'script';
      if (double) i++;
      needCommand = c === '|' || c === '&';
      continue;
    }
    if (/\s/.test(c)) { flush(); continue; }
    started = true; word += c;
  }
  if (quote) return 'script';
  const had = end();
  if (needCommand && !had) return 'script';
  if (!commands.length) return 'script';
  const operations = [];
  for (const args of commands) {
    const first = args[0];
    if (first.quoted || reserved.has(first.text) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(first.text)) return 'script';
    if (incidental.has(first.text)) continue;
    if (!programs.has(first.text)) return 'script';
    let op = first.text;
    if (op === 'git') {
      let i = 1;
      for (; i < args.length; i++) {
        const option = args[i].text;
        if (args[i].quoted) break;
        if (['--git-dir', '--work-tree', '--namespace', '-C', '-c'].includes(option)) {
          if (!args[++i]) return 'script';
        } else if (/^--(git-dir|work-tree|namespace)=/.test(option) || /^-(C|c).+/.test(option) || ['--no-pager', '--paginate', '--bare', '--literal-pathspecs', '--no-optional-locks'].includes(option)) {
          continue;
        } else break;
      }
      if (args[i] && !args[i].quoted && gitOps.has(args[i].text)) op += ` ${args[i].text}`;
      else return 'script';
    }
    operations.push(op);
  }
  if (!operations.length || operations.length > 8) return 'script';
  return operations.join(' → ');
}
export function summaryInput(name, args) {
  if (!tools.has(name)) return undefined;
  if (name !== 'bash') return `Tool: ${name}`;
  return `Tool: bash; operations: ${operationLabel(args?.command)}`;
}
export function cleanSummary(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[*`#<>]/g, '').trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 80);
}
