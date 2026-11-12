-- Provider-neutral live-buffer transaction.
-- Whole-buffer SHA-256 revision plus exact ranges; one undo block; save only when asked.
local M = {}

local function refuse(message)
  error("ipe delegated-edit: " .. message, 0)
end

local function decode(value, field)
  local ok, decoded = pcall(vim.base64.decode, value)
  if not ok then
    refuse("invalid base64 in " .. field)
  end
  return decoded
end

local function canonical(path)
  local absolute = vim.fn.fnamemodify(path, ":p")
  local uv = vim.uv or vim.loop
  return uv.fs_realpath(absolute) or absolute
end

local function find_open_buffer(path)
  local wanted = canonical(path)
  local matches = {}
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].buftype == "" then
      local name = vim.api.nvim_buf_get_name(buf)
      if name ~= "" and canonical(name) == wanted then
        table.insert(matches, buf)
      end
    end
  end
  if #matches ~= 1 then
    refuse(("expected exactly one open target buffer; found %d"):format(#matches))
  end
  return matches[1]
end

local function revision_for(buf)
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, true)
  local endofline = vim.bo[buf].endofline and "eol" or "noeol"
  return vim.fn.sha256(endofline .. "\0" .. #lines .. "\0" .. table.concat(lines, "\0"))
end

local function block_lines(text, allow_empty)
  if text == "" then
    if allow_empty then
      return {}
    end
    refuse("before-text must contain at least one line")
  end
  if text:find("\r", 1, true) then
    refuse("carriage returns are not valid buffer text")
  end
  return vim.split(text, "\n", { plain = true })
end

local function read_request(request_path)
  local fields = vim.fn.readfile(request_path, "b")
  if #fields < 4 then
    refuse("malformed request")
  end
  local request = {
    path = decode(fields[1], "path"),
    revision = fields[2],
    save = fields[3] == "save",
    count = tonumber(fields[4]),
    operations = {},
  }
  if not request.revision:match("^[0-9a-f]+$") or #request.revision ~= 64 then
    refuse("revision must be a SHA-256 digest")
  end
  if fields[3] ~= "save" and fields[3] ~= "no-save" then
    refuse("save mode must be save or no-save")
  end
  if not request.count or request.count < 1 or request.count % 1 ~= 0 then
    refuse("operation count must be a positive integer")
  end
  if #fields ~= 4 + request.count * 3 then
    refuse("operation count does not match request length")
  end
  for index = 1, request.count do
    local offset = 4 + (index - 1) * 3
    local start = tonumber(fields[offset + 1])
    if not start or start < 1 or start % 1 ~= 0 then
      refuse(("operation %d start line must be a positive integer"):format(index))
    end
    local before_text = decode(fields[offset + 2], ("operation %d before-text"):format(index))
    local after_text = decode(fields[offset + 3], ("operation %d after-text"):format(index))
    table.insert(request.operations, {
      index = index,
      start = start,
      before = block_lines(before_text, false),
      after = block_lines(after_text, true),
    })
  end
  return request
end

function M.revision(path_b64)
  local path = decode(path_b64, "path")
  local buf = find_open_buffer(path)
  local state = vim.bo[buf].modified and "modified" or "saved"
  return ("revision\t%s\t%s\tlines=%d"):format(
    revision_for(buf),
    state,
    vim.api.nvim_buf_line_count(buf)
  )
end

function M.apply(request_path)
  local request = read_request(request_path)
  local buf = find_open_buffer(request.path)
  if not vim.bo[buf].modifiable or vim.bo[buf].readonly then
    refuse("target buffer is not writable")
  end
  if revision_for(buf) ~= request.revision then
    refuse("whole-buffer revision mismatch; read a fresh diff and revision")
  end

  local current = vim.api.nvim_buf_get_lines(buf, 0, -1, true)
  local ordered = vim.deepcopy(request.operations)
  table.sort(ordered, function(left, right)
    return left.start < right.start
  end)

  local previous_end = 0
  for _, operation in ipairs(ordered) do
    local finish = operation.start + #operation.before - 1
    if finish > #current then
      refuse(("operation %d extends past end of buffer"):format(operation.index))
    end
    if operation.start <= previous_end then
      refuse(("operation %d overlaps another operation"):format(operation.index))
    end
    for line_offset, expected in ipairs(operation.before) do
      if current[operation.start + line_offset - 1] ~= expected then
        refuse(("operation %d before-text mismatch at line %d"):format(
          operation.index,
          operation.start + line_offset - 1
        ))
      end
    end
    previous_end = finish
  end

  table.sort(ordered, function(left, right)
    return left.start > right.start
  end)
  vim.api.nvim_buf_call(buf, function()
    for index, operation in ipairs(ordered) do
      if index > 1 then
        vim.cmd("undojoin")
      end
      vim.api.nvim_buf_set_lines(
        buf,
        operation.start - 1,
        operation.start - 1 + #operation.before,
        true,
        operation.after
      )
    end
  end)

  if not request.save then
    return ("applied\tmodified\toperations=%d"):format(request.count)
  end
  local ok, write_error = pcall(vim.api.nvim_buf_call, buf, function()
    vim.cmd("silent write")
  end)
  if not ok then
    refuse("write failed; the delegated edits remain visible and unsaved for recovery: " .. tostring(write_error))
  end
  return ("applied\tsaved\toperations=%d"):format(request.count)
end

return M
