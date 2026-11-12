-- Pi transport/presentation around the unchanged IPE transaction core and
-- locally corrected backup core.
local M = { pane = nil, selection = nil }
local api, uv = vim.api, vim.uv
local function refuse(s) error('IPE Pi: ' .. s, 0) end
local function canonical(p)
  local absolute = vim.fs.normalize(vim.fn.fnamemodify(p, ':p'))
  local resolved = uv.fs_realpath(absolute)
  if resolved then return resolved end
  local parent = vim.fs.dirname(absolute)
  if not parent or parent == absolute then return absolute end
  return canonical(parent):gsub('/$', '') .. '/' .. vim.fs.basename(absolute)
end
local function allowed(p)
  local path = canonical(p)
  if path ~= M.root and path:sub(1, #M.root + 1) ~= M.root .. '/' then refuse('target outside seat root') end
  if path:find('/.git/', 1, true) or path:find('/.local/share/secure/', 1, true) then refuse('excluded target') end
  return path
end
local function primary()
  if not M.win or not api.nvim_win_is_valid(M.win) then refuse('primary editor window closed') end
  local b = api.nvim_win_get_buf(M.win)
  if vim.bo[b].buftype ~= '' then refuse('primary window is not a normal buffer') end
  local name = api.nvim_buf_get_name(b)
  if name ~= '' then allowed(name) end
  return b
end
local function target(path)
  if type(path) ~= 'string' or path == '' then refuse('named buffer required') end
  local wanted, found = allowed(path), {}
  for _, b in ipairs(api.nvim_list_bufs()) do
    if api.nvim_buf_is_loaded(b) and vim.bo[b].buftype == '' and api.nvim_buf_get_name(b) ~= ''
      and canonical(api.nvim_buf_get_name(b)) == wanted then found[#found + 1] = b end
  end
  if #found ~= 1 then refuse('expected exactly one loaded named target') end
  return found[1]
end
local function revision(b)
  local lines = api.nvim_buf_get_lines(b, 0, -1, true)
  return vim.fn.sha256((vim.bo[b].endofline and 'eol' or 'noeol') .. '\0' .. #lines .. '\0' .. table.concat(lines, '\0'))
end
-- Extracted predicate from current ipe/editline.lua:190-214; no model-backed actions.
local function locked(buf, lnum)
  local lines = api.nvim_buf_get_lines(buf, 0, 400, false)
  local declared, edit_at = false, nil
  local in_fm, fm_done = false, false
  for i, l in ipairs(lines) do
    if i == 1 and l:match('^%-%-%-%s*$') then in_fm = true
    elseif in_fm and l:match('^%-%-%-%s*$') then in_fm, fm_done = false, true
    elseif in_fm and l:match('^state:%s*locked%s*$') then declared = true end
    if not edit_at and l:match('^%s*%[EDIT%]%s*$') then edit_at = i end
    if fm_done and edit_at then break end
  end
  if not declared then return false end
  if not edit_at then return true end
  return lnum < edit_at
end
function M.capture(visual)
  local b = primary()
  local row = api.nvim_win_get_cursor(M.win)[1]
  local first, last = row, row
  if visual then first = vim.fn.line('v'); last = vim.fn.line('.') end
  M.selection = { buf = b, revision = revision(b), first = math.min(first, last), last = math.max(first, last), scope = 'whole lines' }
end
local function state(b)
  local lines = api.nvim_buf_get_lines(b, 0, -1, true)
  local row = api.nvim_win_get_cursor(M.win)[1]
  local selection = M.selection and M.selection.buf == b and vim.deepcopy(M.selection) or nil
  if selection then selection.fresh = selection.revision == revision(b) end
  return { path = api.nvim_buf_get_name(b), buffer = b, revision = revision(b), modified = vim.bo[b].modified,
    lines = lines, endofline = vim.bo[b].endofline, fileformat = vim.bo[b].fileformat,
    fileencoding = vim.bo[b].fileencoding, cursor = api.nvim_win_get_cursor(M.win), selection = selection,
    head = (function() for n = row, math.max(1, row - 799), -1 do
      local h = lines[n]:match('^%[([A-Z]+)%]%s*$'); if h then return h end end end)(),
    root = M.root, identity = M.id, save = 'explicit only', unnamed_edit = false }
end
local function dispatch(q)
  if q.identity ~= M.id then refuse('editor identity mismatch') end
  local editor = primary()
  if q.action == 'read' then return state(editor) end
  local b = target(q.path)
  if q.revision ~= revision(b) then refuse('revision mismatch; reread live buffer') end
  if q.action == 'diff' then
    local f = io.open(api.nvim_buf_get_name(b), 'rb')
    local disk = ''
    if f then disk = f:read('*a'); f:close()
    else
      local _, _, code = uv.fs_stat(api.nvim_buf_get_name(b))
      if code ~= 'ENOENT' then refuse('cannot read disk baseline') end
    end
    local live = table.concat(api.nvim_buf_get_lines(b, 0, -1, true), '\n') .. (vim.bo[b].endofline and '\n' or '')
    return { revision = revision(b), diff = vim.diff(disk, live, { result_type = 'unified', ctxlen = 3 }),
      ceiling = 'disk bytes versus LF editor text; not an encoding/fileformat conversion or external-disk revision check' }
  end
  if q.action == 'save' then
    if vim.bo[b].readonly or not vim.bo[b].modifiable then refuse('target not writable') end
    local ok, err = pcall(api.nvim_buf_call, b, function() vim.cmd('silent write') end)
    if not ok then refuse('save failed; live edits retained: ' .. tostring(err)) end
    return { saved = true, revision = revision(b), path = q.path }
  end
  if q.action == 'backup' then
    local d = require('durability')
    local result = d.snapshot(b, 'pi-tool')
    local snap, log = d.paths(b)
    return { result = result, snapshot = snap, log = log,
      ceiling = 'named buffers only; LF plus final newline; log failure returns an error after snapshot replacement, without rollback; no fsync' }
  end
  if q.action ~= 'apply' then refuse('unknown action') end
  if type(q.operations) ~= 'table' or #q.operations < 1 or #q.operations > 128 then refuse('1..128 operations required') end
  local fields = { vim.base64.encode(q.path), q.revision, 'no-save', tostring(#q.operations) }
  for _, op in ipairs(q.operations) do
    if type(op.start) ~= 'number' or op.start < 1 or op.start % 1 ~= 0
      or type(op.before) ~= 'string' or op.before == '' or type(op.after) ~= 'string' then refuse('invalid operation') end
    if op.before:find('\r', 1, true) or op.after:find('\r', 1, true) then refuse('CR in buffer text') end
    local count = #vim.split(op.before, '\n', { plain = true })
    if op.start + count - 1 > api.nvim_buf_line_count(b) then refuse('range past end') end
    for n = op.start, op.start + count - 1 do if locked(b, n) then refuse('locked span') end end
    fields[#fields + 1] = tostring(op.start)
    fields[#fields + 1] = vim.base64.encode(op.before)
    fields[#fields + 1] = vim.base64.encode(op.after)
  end
  -- The unchanged shared core validates every range and joins changes into one undo.
  local request = vim.fn.tempname()
  local ok, result = pcall(function()
    vim.fn.writefile(fields, request, 'b')
    if vim.fn.setfperm(request, 'rw-------') ~= 1 then refuse('private request mode failed') end
    return require('ipe.delegated_edit').apply(request)
  end)
  vim.fn.delete(request)
  if not ok then error(result, 0) end
  return { result = result, revision = revision(b), saved = false }
end
function M.rpc(encoded)
  local ok, result = pcall(function()
    if #encoded > 2800000 then refuse('request too large') end
    return dispatch(vim.json.decode(vim.base64.decode(encoded)))
  end)
  return vim.json.encode(ok and { ok = true, result = result } or { ok = false, error = tostring(result) })
end
function M.alive()
  return M.pane and api.nvim_buf_is_valid(M.pane.buf) and vim.fn.jobwait({ M.pane.job }, 0)[1] == -1 or false
end
function M.reveal()
  primary()
  if M.pane and M.pane.win and api.nvim_win_is_valid(M.pane.win) and M.alive() then
    api.nvim_set_current_win(M.pane.win); return 'shown'
  end
  if M.pane and not M.alive() then
    if api.nvim_buf_is_valid(M.pane.buf) then api.nvim_buf_delete(M.pane.buf, { force = true }) end
    M.pane = nil
  end
  api.nvim_set_current_win(M.win)
  local right = vim.o.columns / vim.o.lines > 2.8
  vim.cmd(right and 'botright vsplit' or 'topleft split')
  local w = api.nvim_get_current_win()
  if right then api.nvim_win_set_width(w, math.max(1, math.floor(vim.o.columns * 0.4)))
  else api.nvim_win_set_height(w, math.max(1, math.floor(vim.o.lines * 0.4))) end
  if M.pane then api.nvim_win_set_buf(w, M.pane.buf); M.pane.win = w; return 'shown' end
  local b = api.nvim_create_buf(false, true)
  api.nvim_win_set_buf(w, b)
  local job = vim.fn.jobstart(M.command, { term = true, cwd = M.root,
    env = { NVIM = vim.v.servername, IPE_PI_ID = M.id } })
  if job <= 0 then api.nvim_win_close(w, true); refuse('Pi process failed to start') end
  M.pane = { buf = b, job = job, win = w }
  vim.bo[b].bufhidden = 'hide'
  vim.cmd('startinsert')
  return 'opened'
end
function M.toggle()
  if M.pane and M.pane.win and api.nvim_win_is_valid(M.pane.win) and M.alive() then
    api.nvim_win_close(M.pane.win, true); api.nvim_set_current_win(M.win); return 'hidden'
  end
  return M.reveal()
end
function M.setup(opts)
  if M.id then return end
  opts = opts or {}
  M.root = canonical(opts.root or vim.env.IPE_PI_ROOT or uv.cwd()):gsub('/$', '')
  if M.root == '' then refuse('filesystem root is not a seat root') end
  M.id = vim.fn.sha256(uv.random(32))
  M.win = api.nvim_get_current_win()
  M.command = opts.command or { 'pi' }
  api.nvim_create_user_command('IpePi', function() M.capture(false); M.toggle() end, {})
  vim.keymap.set('n', '<leader>pp', function() M.capture(false); M.toggle() end, { desc = 'IPE Pi pane' })
  vim.keymap.set('x', '<leader>pp', function()
    M.capture(true); vim.cmd('normal! ' .. string.char(27)); M.reveal()
  end, { desc = 'IPE Pi whole-line selection' })
  if vim.env.IPE_PI_AUTOSTART == '1' then
    api.nvim_create_autocmd('VimEnter', { once = true, callback = function() M.capture(false); M.reveal() end })
  end
end
return M
