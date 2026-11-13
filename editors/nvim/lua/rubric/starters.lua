-- A part's starter, in the editor: what the preview draws faded in a block
-- with nothing in it yet (three `###` steps, a heading and a line), shown
-- dimmed inside the block, so the writer sees what to write instead of
-- guessing it. It shows only while the cursor is on the block's opening
-- line: inside the block, where the writer types, it would stand in the way.
-- The accept key anywhere in the block, its part's line too, fills it
-- in for real. The server sends each page's empty blocks and their starters
-- whenever they change (rubric/starters), with the lines placing the site's
-- own parts, where the accept key opens the part's menu instead (drafts.lua).

local M = {}

local ns = vim.api.nvim_create_namespace("rubric.starters")
vim.api.nvim_set_hl(0, "RubricStarter", { link = "Comment", default = true })
vim.api.nvim_set_hl(0, "RubricStarterHint", { link = "NonText", default = true })

local accept_key = "<M-l>"
-- Each page's starters, as the server last sent them.
local by_buf = {}
-- Each page's lines placing the site's own parts, which the accept key on
-- the line can reroll, keep or remove.
local own_by_buf = {}
local own_ns = vim.api.nvim_create_namespace("rubric.own")

function M.set_accept(key)
  accept_key = key
end

local function closer(text)
  return text ~= nil and text:match("^%s*:::+%s*$") ~= nil
end

-- Whether the block the server described is still there and still empty.
local function still(bufnr, s)
  local lines = vim.api.nvim_buf_get_lines(bufnr, s.line, s.close + 1, false)
  if #lines ~= s.close - s.line + 1 or lines[1] ~= s.opener or not closer(lines[#lines]) then
    return false
  end
  for i = 2, #lines - 1 do
    if lines[i]:match("%S") then
      return false
    end
  end
  return true
end

function M.render(bufnr)
  if not vim.api.nvim_buf_is_loaded(bufnr) then
    return
  end
  vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
  if vim.api.nvim_get_current_buf() ~= bufnr then
    return
  end
  local row = vim.api.nvim_win_get_cursor(0)[1] - 1
  for _, s in ipairs(by_buf[bufnr] or {}) do
    if s.line == row and still(bufnr, s) then
      local indent = vim.api.nvim_buf_get_lines(bufnr, s.line, s.line + 1, false)[1]:match("^%s*")
      local lines = {}
      for i, text in ipairs(s.body) do
        local line = { { indent .. text, "RubricStarter" } }
        if i == 1 then
          table.insert(line, { ("   %s fills it in"):format(accept_key), "RubricStarterHint" })
        end
        table.insert(lines, line)
      end
      -- Inside the block, just above its closer.
      pcall(vim.api.nvim_buf_set_extmark, bufnr, ns, s.close, 0, { virt_lines = lines, virt_lines_above = true })
    end
  end
end

-- rubric/starters: a page's empty blocks changed.
function M.handler(_, params)
  -- Only for a page still open: a late one for a closed page is dropped.
  local bufnr = vim.fn.bufnr(vim.uri_to_fname(params.uri))
  if bufnr == -1 then
    return
  end
  by_buf[bufnr] = params.starters or {}
  own_by_buf[bufnr] = params.own or {}
  M.render(bufnr)
  M.hint(bufnr)
end

-- The site's own part placed on line `row`, if it still is: the line may
-- have changed since, with settings or words after it.
function M.own_at(bufnr, row)
  local text = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1]
  for _, o in ipairs(own_by_buf[bufnr] or {}) do
    if o.line == row and text and text:match("^%s*:::+%s*" .. vim.pesc(o.part) .. "%f[^%w_-]") then
      return o
    end
  end
end

-- On the cursor's line, in normal mode, a quiet word that the accept key
-- does something here. A line with takes says so under it already.
function M.hint(bufnr)
  if not vim.api.nvim_buf_is_loaded(bufnr) then
    return
  end
  vim.api.nvim_buf_clear_namespace(bufnr, own_ns, 0, -1)
  if vim.api.nvim_get_current_buf() ~= bufnr or vim.api.nvim_get_mode().mode ~= "n" then
    return
  end
  local row = vim.api.nvim_win_get_cursor(0)[1] - 1
  local o = M.own_at(bufnr, row)
  -- A catalog part the site has not changed: the key changes it, which is
  -- not worth a word on every line that places one.
  if o and not o.takes and not o.catalog then
    local hint = o.changed and ("  %s reroll %s, or back to the catalog's") or ("  %s reroll, keep or remove %s")
    pcall(vim.api.nvim_buf_set_extmark, bufnr, own_ns, row, 0, {
      virt_text = { { hint:format(accept_key, o.part), "RubricStarterHint" } },
      virt_text_pos = "eol",
    })
  end
end

-- The starter for the block `row` opens, is inside of or closes, if any.
function M.at(bufnr, row)
  for _, s in ipairs(by_buf[bufnr] or {}) do
    if row >= s.line and row <= s.close and still(bufnr, s) then
      return s
    end
  end
end

-- Puts the starter in its block, in place of the empty lines, with the
-- cursor on its first line.
function M.fill(bufnr, s)
  local indent = vim.api.nvim_buf_get_lines(bufnr, s.line, s.line + 1, false)[1]:match("^%s*")
  local body = {}
  for _, text in ipairs(s.body) do
    table.insert(body, text == "" and "" or indent .. text)
  end
  vim.api.nvim_buf_set_lines(bufnr, s.line + 1, s.close, false, body)
  -- Kept: undone at once, the block is empty again and its starter shows.
  M.render(bufnr)
  local win = vim.api.nvim_win_get_buf(0) == bufnr and vim.api.nvim_get_current_win() or vim.fn.bufwinid(bufnr)
  if win ~= -1 then
    vim.api.nvim_win_set_cursor(win, { s.line + 2, #indent })
  end
end

-- Follows a page: a starter goes as soon as its block has anything in it,
-- before the server says so.
function M.watch(bufnr)
  local group = vim.api.nvim_create_augroup("RubricStarters" .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
    group = group,
    buffer = bufnr,
    callback = function()
      M.render(bufnr)
    end,
  })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "ModeChanged", "BufEnter", "BufLeave" }, {
    group = group,
    buffer = bufnr,
    callback = function(ev)
      if ev.event == "BufLeave" then
        vim.api.nvim_buf_clear_namespace(bufnr, own_ns, 0, -1)
        vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
      else
        M.render(bufnr)
        if ev.event ~= "CursorMovedI" then
          M.hint(bufnr)
        end
      end
    end,
  })
  -- Unloaded, its marks are gone; the server sends them again on reopening.
  vim.api.nvim_create_autocmd("BufUnload", {
    group = group,
    buffer = bufnr,
    callback = function()
      by_buf[bufnr] = nil
      own_by_buf[bufnr] = nil
    end,
  })
  M.render(bufnr)
end

return M
