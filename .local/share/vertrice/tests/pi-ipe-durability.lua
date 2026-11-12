-- Synthetic recovery data; separate write/close fault injection, no disk exhaustion.
local source, scratch = arg[1], arg[2]
package.path = source .. '/.config/ipe-pi/lua/?.lua;' .. package.path
local d = require('durability')
d.dir = scratch .. '/durability'
vim.fn.mkdir(d.dir, 'p')
vim.notify = function() end
local function read(p)
  local f = assert(io.open(p, 'r'))
  local s = f:read('*a'); assert(f:close()); return s
end
local function write(p, s)
  local f = assert(io.open(p, 'w')); assert(f:write(s)); assert(f:close())
end
local function buffer(name, text)
  local b = vim.api.nvim_create_buf(true, false)
  vim.api.nvim_buf_set_name(b, name)
  vim.api.nvim_buf_set_lines(b, 0, -1, false, {text})
  return b
end
local a = scratch .. '/a%b/c.md'
local b = scratch .. '/a/b%c.md'
local legacy = d.dir .. '/' .. a:gsub('/', '%%')
assert(a:gsub('/', '%%') == b:gsub('/', '%%'))
write(legacy .. '.snap', 'ambiguous legacy snapshot\n')
write(legacy .. '.log', 'ambiguous legacy history\n')
local intermediate = d.dir .. '/v2-' .. a:gsub('%%', '%%25'):gsub('/', '%%2F')
write(intermediate .. '.snap', 'intermediate snapshot\n')
write(intermediate .. '.log', 'intermediate history\n')
local ba, bb = buffer(a, 'first'), buffer(b, 'second')
local sa, la = d.paths(ba)
local sb, lb = d.paths(bb)
assert(sa ~= sb and la ~= lb)
assert(d.key(a) == 'v3-' .. vim.fn.sha256(vim.fn.fnamemodify(a, ':p')))
assert(d.key(scratch .. '/%2F') ~= d.key(scratch .. '//'))
assert(d.snapshot(ba, 'collision') == 'snapshot')
assert(d.snapshot(bb, 'collision') == 'snapshot')
assert(read(sa) == 'first\n' and read(sb) == 'second\n')
assert(not read(la):find('ambiguous legacy', 1, true))
assert(not read(la):find('intermediate snapshot', 1, true))
assert(not read(lb):find('ambiguous legacy', 1, true))
assert(read(legacy .. '.snap') == 'ambiguous legacy snapshot\n')
assert(read(legacy .. '.log') == 'ambiguous legacy history\n')
assert(read(intermediate .. '.snap') == 'intermediate snapshot\n')
assert(read(intermediate .. '.log') == 'intermediate history\n')

-- Real valid long path: all components fit NAME_MAX, but the former escaped
-- single basename exceeds it. Snapshot and temporary names must stay bounded.
local long = scratch .. '/' .. string.rep('nested/', 15) .. string.rep('a', 95) .. '.md'
vim.fn.mkdir(vim.fn.fnamemodify(long, ':h'), 'p')
write(long, 'saved long path\n')
local bl = buffer(long, 'recover long path')
local sl, ll = d.paths(bl)
local tmpname = vim.fn.fnamemodify(sl .. '.tmp.' .. tostring(vim.uv.getpid()), ':t')
local oldtmp = 'v2-' .. long:gsub('%%', '%%25'):gsub('/', '%%2F') .. '.snap.tmp.' .. tostring(vim.uv.getpid())
assert(#long >= 214 and #oldtmp > 255)
assert(#tmpname <= 255 and #d.key(long) == 67)
assert(d.snapshot(bl, 'long-path') == 'snapshot')
assert(read(sl) == 'recover long path\n')
assert(read(long) == 'saved long path\n')
assert(read(ll):find(long, 1, true))
assert(vim.fn.glob(sl .. '.tmp.*') == '')
print('PASS durability long absolute path snapshot; bounded temporary basename bytes=' .. #tmpname)

local open, rename = io.open, os.rename
for _, lane in ipairs({'snapshot', 'log'}) do
  for _, failure in ipairs({'write', 'close'}) do
    d.ticks[ba], d.last[ba] = nil, nil
    vim.api.nvim_buf_set_lines(ba, 0, -1, false, {lane .. failure})
    local old = read(sa)
    local renamed, closed = false, false
    io.open = function(p, mode)
      local f, err = open(p, mode)
      if not f then return nil, err end
      if (lane == 'snapshot' and mode == 'w') or (lane == 'log' and mode == 'a') then
        return {
          write = function(_, s)
            if failure == 'write' then return nil, 'injected write failure' end
            return f:write(s)
          end,
          close = function()
            closed = true
            local ok, cerr = f:close()
            if failure == 'close' then return nil, 'injected close failure' end
            return ok, cerr
          end,
        }
      end
      return f
    end
    os.rename = function(from, to) renamed = true; return rename(from, to) end
    local result = d.snapshot(ba, 'fault')
    io.open, os.rename = open, rename
    assert(result == 'error: injected ' .. failure .. ' failure', result)
    assert(closed and d.ticks[ba] == nil and d.last[ba] == nil)
    if lane == 'snapshot' then
      assert(not renamed and read(sa) == old)
      assert(vim.fn.glob(sa .. '.tmp.*') == '')
    else
      assert(renamed and read(sa) == lane .. failure .. '\n')
    end
    assert(d.snapshot(ba, 'retry') == 'snapshot')
    assert(d.ticks[ba] == vim.api.nvim_buf_get_changedtick(ba))
    print('PASS durability ' .. lane .. ' ' .. failure .. ' failure and retry')
  end
end
assert(read(legacy .. '.snap') == 'ambiguous legacy snapshot\n')
assert(read(legacy .. '.log') == 'ambiguous legacy history\n')
assert(read(intermediate .. '.snap') == 'intermediate snapshot\n')
assert(read(intermediate .. '.log') == 'intermediate history\n')
print('PASS durability versioned collision-resistant keys and untouched legacy/intermediate files')
