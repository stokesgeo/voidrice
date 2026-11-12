-- durability.lua: automatic backups, separate from explicit working-file saves.
--
--   :w            writes the working file. Nothing in this module calls
--                 :update or :write, and autowriteall is off.
--   backup lane   continuous, automatic, never touches the working file.
--                 For every modified, named, normal-file buffer it keeps
--                 under BACKUP_DIR (default stdpath('state')/ipe-backup,
--                 using this seat's NVIM_APPNAME=ipe-pi state directory,
--                 not checked for worktree membership;
--                 env IPE_BACKUP_DIR overrides):
--                   <key>.snap   the buffer as of the last tick, plain text
--                                — `cp` restores it with no nvim running
--                   <key>.log    append-only: one stamped header + the
--                                unified diff of snap→buffer per tick, so
--                                the HISTORY is there, not only the state
--                 <key> is v3- plus SHA-256 of the absolute path. The log
--                 header retains the path; older keys stay untouched.
--
-- Ticks: idle debounce (IDLE_MS after the last change), a hard timer
-- (PERIOD_MS), FocusLost, BufLeave, and VimLeavePre. VimLeavePre now
-- writes the BACKUP lane, not the file: `:q!` discards working-file edits,
-- and the snapshot taken on the way out still holds
-- it. A tick that finds the buffer unchanged since the last snapshot
-- (changedtick) writes nothing. Checked write+close precedes temp+rename;
-- snapshot write/close failures preserve the previous snapshot. Log failures
-- return an error after snapshot replacement, without rollback. No fsync.
-- The diff is nvim's own `vim.diff` — no
-- external process, no shell.
--
-- Persistent undo (`undofile`, init.lua) stays on beside this: it is free
-- and native, but it persists only on :w and is readable only from inside
-- nvim, so it is not the net. Swap files stay on for the crash case.
--
-- Scope: all modified normal named files, selected by `eligible` below.
local M = {}

M.IDLE_MS = 5000
M.PERIOD_MS = 30000
M.dir = os.getenv("IPE_BACKUP_DIR")
  or (vim.fn.stdpath("state") .. "/ipe-backup")
M.ticks = {}   -- bufnr → changedtick at last snapshot
M.last = {}    -- bufnr → { path=, when=, bytes= } of the last snapshot written

local uv = vim.uv or vim.loop

local function eligible(buf)
  return vim.api.nvim_buf_is_loaded(buf)
    and vim.bo[buf].buftype == ""
    and vim.bo[buf].modifiable
    and vim.api.nvim_buf_get_name(buf) ~= ""
end

--- Bounded, collision-resistant key (not mathematically injective). Never
--- read/migrate legacy or intermediate keys; legacy ownership is ambiguous.
function M.key(path)
  return "v3-" .. vim.fn.sha256(vim.fn.fnamemodify(path, ":p"))
end

function M.paths(buf)
  local name = vim.api.nvim_buf_get_name(buf)
  local k = M.key(name)
  return M.dir .. "/" .. k .. ".snap", M.dir .. "/" .. k .. ".log"
end

local function read_file(p)
  local f = io.open(p, "r")
  if not f then return nil end
  local s = f:read("*a"); f:close()
  return s
end

local function write_atomic(p, s)
  local tmp = p .. ".tmp." .. tostring(uv.getpid())
  local f, err = io.open(tmp, "w")
  if not f then return false, err end
  local wrote, werr = f:write(s)
  local closed, cerr = f:close()
  if not wrote or not closed then
    os.remove(tmp)
    return false, werr or cerr
  end
  local ok, rerr = os.rename(tmp, p)
  if not ok then os.remove(tmp); return false, rerr end
  return true
end

local function append(p, s)
  local f, err = io.open(p, "a")
  if not f then return false, err end
  local wrote, werr = f:write(s)
  local closed, cerr = f:close()
  if not wrote or not closed then return false, werr or cerr end
  return true
end

--- snapshot ONE buffer if it changed since the last snapshot.
--- Returns "unchanged" | "clean" | "snapshot" | "error: …"
function M.snapshot(buf, why)
  if not eligible(buf) then return "ineligible" end
  local tick = vim.api.nvim_buf_get_changedtick(buf)
  if M.ticks[buf] == tick then return "unchanged" end
  if not vim.bo[buf].modified then
    -- the working file IS the state; remember the tick so the next tick is cheap
    M.ticks[buf] = tick
    return "clean"
  end
  vim.fn.mkdir(M.dir, "p")
  local snap, log = M.paths(buf)
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local cur = table.concat(lines, "\n") .. "\n"
  local prev = read_file(snap)
  if prev == nil then
    -- first snapshot of this file on this machine: diff against the file
    -- on disk, so the log's first entry is "what the buffer holds beyond :w"
    prev = read_file(vim.api.nvim_buf_get_name(buf)) or ""
  end
  local d = vim.diff(prev, cur, { result_type = "unified", ctxlen = 1 })
  local ok, err = write_atomic(snap, cur)
  if not ok then
    vim.notify("durability: backup snapshot FAILED for " .. snap .. ": " .. tostring(err), vim.log.levels.ERROR)
    return "error: " .. tostring(err)
  end
  local head = string.format("# %s %s tick=%d lines=%d why=%s\n",
    os.date("!%Y-%m-%dT%H:%M:%SZ"), vim.api.nvim_buf_get_name(buf), tick, #lines, why or "tick")
  local okl, lerr = append(log, head .. (d ~= "" and d or "") )
  if not okl then
    vim.notify("durability: backup log append FAILED for " .. log .. ": " .. tostring(lerr), vim.log.levels.ERROR)
    return "error: " .. tostring(lerr)
  end
  M.ticks[buf] = tick
  M.last[buf] = { path = snap, when = os.time(), bytes = #cur }
  return "snapshot"
end

function M.snapshot_all(why)
  local n = 0
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if M.snapshot(buf, why) == "snapshot" then n = n + 1 end
  end
  return n
end

-- kept under the old name so callers that asked the lane to "save
-- everything now" keep working — it saves to the BACKUP lane. It has not
-- written a working file since 2026-08-28.
M.save_all = function() return M.snapshot_all("save_all") end

local function arm_idle(buf)
  if M.idle then M.idle:stop() end
  M.idle = M.idle or uv.new_timer()
  M.idle:start(M.IDLE_MS, 0, vim.schedule_wrap(function()
    if vim.api.nvim_buf_is_valid(buf) then M.snapshot(buf, "idle") end
  end))
end

function M.setup()
  vim.o.autowriteall = false
  local aug = vim.api.nvim_create_augroup("durability", { clear = true })
  vim.api.nvim_create_autocmd({ "FocusLost", "BufLeave", "VimLeavePre" }, {
    group = aug,
    callback = function(ev) M.snapshot_all(ev.event) end,
  })
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "TextChangedP" }, {
    group = aug,
    callback = function(ev) arm_idle(ev.buf) end,
  })
  -- After :w remember the current tick. The next edit still diffs against
  -- the previous snapshot when present, not necessarily the saved text.
  vim.api.nvim_create_autocmd("BufWritePost", {
    group = aug,
    callback = function(ev) M.ticks[ev.buf] = vim.api.nvim_buf_get_changedtick(ev.buf) end,
  })
  if M.timer then M.timer:stop() end
  M.timer = uv.new_timer()
  M.timer:start(M.PERIOD_MS, M.PERIOD_MS, vim.schedule_wrap(function() M.snapshot_all("timer") end))

  vim.api.nvim_create_user_command("IpeBackup", function()
    local n = M.snapshot_all("command")
    vim.notify(("durability: %d buffer(s) snapshotted under %s"):format(n, M.dir))
  end, { desc = "durability: snapshot every modified buffer to the backup lane now" })
  vim.api.nvim_create_user_command("IpeBackupPath", function()
    local snap, log = M.paths(0)
    vim.notify(("durability: snap %s\n            log  %s"):format(snap, log))
  end, { desc = "durability: where this buffer's backup snapshot and log live" })
end

return M
