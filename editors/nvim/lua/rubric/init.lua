-- Rubric for Neovim 0.12: the language server, ghost text and two keys.
--
--   vim.opt.runtimepath:append("/path/to/rubric/editors/nvim")
--   require("rubric").setup()
--
-- The server attaches only inside a Rubric site (a folder with rubric.md) and
-- only to Markdown. Ghost text is Neovim's own inline completion.

local M = {}

local defaults = {
  -- Accept the ghost text: pins the line. Before any ghost text shows, it
  -- asks Jev about the line at once instead of waiting for a pause.
  accept = "<M-l>",
  -- Switch between the pick and the runner-up. Not <M-[>: a terminal sends it
  -- as ESC [, the start of an escape sequence, and the next key is lost.
  next = "<M-n>",
  prev = "<M-p>",
  -- Passed to the server's capabilities, e.g. require("cmp_nvim_lsp").default_capabilities().
  capabilities = nil,
  -- Extra arguments for `rubric lsp`, e.g. { "--stub" } to work without Jev.
  args = {},
  -- Typing "::: " on an empty line adds the closing ":::" below it.
  close = true,
}

-- How many blocks are open above `row` (1-based, exclusive): each ":::"
-- opener adds one and each bare ":::" closes the innermost. Code fences are
-- skipped, as the server skips them.
local function open_blocks(bufnr, row)
  local depth, fence = 0, nil
  for _, l in ipairs(vim.api.nvim_buf_get_lines(bufnr, 0, row - 1, false)) do
    local f = l:match("^%s*(```+)") or l:match("^%s*(~~~+)")
    if fence then
      if f and f:sub(1, 1) == fence:sub(1, 1) and #f >= #fence and l:match("^%s*[`~]+%s*$") then
        fence = nil
      end
    elseif f then
      fence = f
    elseif l:match("^%s*:::+%s*$") then
      depth = math.max(depth - 1, 0)
    elseif l:match("^%s*:::+%s*%S") then
      depth = depth + 1
    end
  end
  return depth
end

-- After "::: " is typed on a line of its own, put ":::" on the line below,
-- at the same indent, unless the ":::" already there is free to close it.
-- Inside another block, a ":::" right below is that block's closer, so the new
-- one still gets its own. The space is the trigger because a closer is a bare
-- ":::" and never gets one.
local function close_directive(bufnr)
  vim.keymap.set("i", " ", function()
    local row, col = unpack(vim.api.nvim_win_get_cursor(0))
    local line = vim.api.nvim_get_current_line()
    local indent = line:match("^(%s*):::$")
    if not indent or col ~= #line then
      -- Any other space goes through as typed, abbreviations and all.
      vim.api.nvim_feedkeys(" ", "ni", false)
      return
    end
    local lines = { line .. " " }
    local below = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1]
    if below ~= indent .. ":::" or open_blocks(bufnr, row) > 0 then
      table.insert(lines, indent .. ":::")
    end
    vim.api.nvim_buf_set_lines(bufnr, row - 1, row, false, lines)
    vim.api.nvim_win_set_cursor(0, { row, col + 1 })
  end, { buffer = bufnr, desc = "Rubric: close a directive" })
end

-- nvim-cmp opens its menu when a character is typed, never when one is
-- deleted, so backspacing over "aside" in "kind=aside" left no menu until the
-- next letter. After a deletion on a ":::" line, ask the server again; it
-- offers only what fits where the cursor is, and nothing for words.
local function reopen_completion(bufnr)
  local ok, cmp = pcall(require, "cmp")
  if not ok then
    return
  end
  local last = {}
  vim.api.nvim_create_autocmd("TextChangedI", {
    group = vim.api.nvim_create_augroup("RubricReopen" .. bufnr, { clear = true }),
    buffer = bufnr,
    callback = function()
      local row, col = unpack(vim.api.nvim_win_get_cursor(0))
      local line = vim.api.nvim_get_current_line()
      local deleted = last.row == row and #line < last.len
      last = { row = row, len = #line }
      if deleted and not cmp.visible() and line:sub(1, col):match("^%s*:::") then
        cmp.complete({ config = { sources = { { name = "nvim_lsp" } } } })
      end
    end,
  })
end

-- When Jev offers two picks for a line, say so beside the ghost text: Neovim
-- shows the count only after the writer moves to the next one. The server
-- sends rubric/picks with each ghost text answer; the hint goes as soon as
-- the line changes, the cursor leaves it, or insert mode ends.
local picks_ns = vim.api.nvim_create_namespace("rubric.picks")
local picks_shown = {}
-- Which pick the ghost text is on, for the preview to show the same one.
-- Neovim keeps this to itself, and goes back to the first with every answer.
local picks_at = {}

local function clear_picks(bufnr)
  if picks_shown[bufnr] then
    pcall(vim.api.nvim_buf_clear_namespace, bufnr, picks_ns, 0, -1)
    picks_shown[bufnr] = nil
  end
end

local function picks_handler(next_key)
  return function(_, params)
    local bufnr = vim.uri_to_bufnr(params.uri)
    clear_picks(bufnr)
    picks_at[bufnr] = nil
    if params.count < 2 or not vim.startswith(vim.api.nvim_get_mode().mode, "i") then
      return
    end
    picks_at[bufnr] = { line = params.line, count = params.count, index = 1 }
    local text = vim.api.nvim_buf_get_lines(bufnr, params.line, params.line + 1, false)[1]
    if not text then
      return
    end
    vim.api.nvim_buf_set_extmark(bufnr, picks_ns, params.line, 0, {
      virt_text = { { ("  1 of %d · %s for the next"):format(params.count, next_key), "ComplHintMore" } },
      virt_text_pos = "eol",
      hl_mode = "combine",
    })
    picks_shown[bufnr] = { line = params.line, text = text }
  end
end

local function watch_picks(bufnr)
  local group = vim.api.nvim_create_augroup("RubricPicks" .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd({ "TextChangedI", "CursorMovedI" }, {
    group = group,
    buffer = bufnr,
    callback = function()
      local shown = picks_shown[bufnr]
      if not shown then
        return
      end
      local row = vim.api.nvim_win_get_cursor(0)[1] - 1
      local text = vim.api.nvim_buf_get_lines(bufnr, shown.line, shown.line + 1, false)[1]
      if row ~= shown.line or text ~= shown.text then
        clear_picks(bufnr)
      end
    end,
  })
  vim.api.nvim_create_autocmd("InsertLeave", {
    group = group,
    buffer = bufnr,
    callback = function()
      clear_picks(bufnr)
    end,
  })
end

-- Part names and settings aren't writing, so spell checking leaves them alone,
-- and stays on for the writer's words on either side. Worked out here, not by
-- the server, so a pick accepted or a setting typed never flashes a squiggle
-- while the change is on its way. Without the catalog, a lone word reads as a
-- part name, and a setting still being typed as a setting.
local spell_ns = vim.api.nvim_create_namespace("rubric.spell")

-- Where the plain form starting at `pos` ends: past its last token, before any
-- ":" and the words after it. Nil when the text isn't shaped like a plain form.
local function plain_end(line, pos)
  local stop = line:match("^%l[%l%d-]*()", pos)
  if not stop or not line:find("^%s", stop) and stop <= #line then
    return nil
  end
  while true do
    pos = line:match("^%s*()", stop)
    if pos > #line or line:find("^:%s", pos) or line:find("^:$", pos) then
      return stop
    end
    stop = line:match('^%l[%l%d-]*="[^"]*"()', pos)
      or line:match('^%l[%l%d-]*="[^"]*$', pos) and #line + 1
      or line:match('^%l[%l%d-]*=[^%s"]*()', pos)
    if not stop then
      return nil
    end
  end
end

-- The columns of a directive line's plain form, as the scanner reads it: after
-- the first " -> " with a plain form on its right, or the last when none has.
local function plain_span(line)
  local from = line:match("^%s*:::+%s*()%S")
  if not from then
    return nil
  end
  local arrow, at = nil, from
  while true do
    local s, e = line:find(" -> ", at, true)
    if not s then
      break
    end
    local stop = plain_end(line, e + 1)
    if stop then
      return e + 1, stop
    end
    arrow, at = e + 1, s + 1
  end
  if arrow then
    return arrow, #line + 1
  end
  local stop = plain_end(line, from)
  if stop then
    return from, stop
  end
end

local function mark_plain(bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr, spell_ns, 0, -1)
  for row, line in ipairs(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)) do
    local start, stop = plain_span(line)
    if start then
      -- Above treesitter, which marks a Markdown line's text as spellable.
      vim.api.nvim_buf_set_extmark(bufnr, spell_ns, row - 1, start - 1, { end_col = stop - 1, spell = false, priority = 200 })
    end
  end
end

local function watch_spell(bufnr)
  mark_plain(bufnr)
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "TextChangedP" }, {
    group = vim.api.nvim_create_augroup("RubricSpell" .. bufnr, { clear = true }),
    buffer = bufnr,
    callback = function()
      mark_plain(bufnr)
    end,
  })
end

-- Where the cursor is, for the live preview to follow: sent when it moves to
-- another line or another page, a moment after it stops, so holding j sends
-- one, not fifty.
local function send_cursor(bufnr, client_id)
  local timer = assert(vim.uv.new_timer())
  local last
  local function send()
    local client = vim.lsp.get_client_by_id(client_id)
    if not client or not vim.api.nvim_buf_is_valid(bufnr) or vim.api.nvim_get_current_buf() ~= bufnr then
      return
    end
    local line = vim.api.nvim_win_get_cursor(0)[1] - 1
    if line == last then
      return
    end
    last = line
    client:notify("rubric/cursor", { uri = vim.uri_from_bufnr(bufnr), line = line })
  end
  local group = vim.api.nvim_create_augroup("RubricCursor" .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = group,
    buffer = bufnr,
    callback = function()
      timer:stop()
      timer:start(60, 0, vim.schedule_wrap(send))
    end,
  })
  -- Back in this page from another: the preview opens it again.
  vim.api.nvim_create_autocmd("BufEnter", {
    group = group,
    buffer = bufnr,
    callback = function()
      last = nil
      timer:stop()
      timer:start(60, 0, vim.schedule_wrap(send))
    end,
  })
  vim.api.nvim_create_autocmd("BufWipeout", {
    group = group,
    buffer = bufnr,
    callback = function()
      timer:stop()
      timer:close()
    end,
  })
end

-- The repository root, from where this file sits.
local function repo_root()
  local here = debug.getinfo(1, "S").source:sub(2)
  return vim.fs.dirname(vim.fs.dirname(vim.fs.dirname(vim.fs.dirname(vim.fs.dirname(here)))))
end

function M.setup(opts)
  opts = vim.tbl_extend("force", defaults, opts or {})
  local root = repo_root()

  vim.lsp.config("rubric", {
    cmd = vim.list_extend({ "bun", root .. "/src/cli.ts", "lsp" }, opts.args),
    -- Bun loads .env from the working directory; the repo's holds TYPESAFE_API_KEY.
    cmd_cwd = root,
    filetypes = { "markdown" },
    root_markers = { "rubric.md" },
    capabilities = opts.capabilities,
    handlers = { ["rubric/picks"] = picks_handler(opts.next) },
  })
  vim.lsp.enable("rubric")

  -- Accepting first inserts the ghost text, which only shows what is picked
  -- or what changes; this then writes the whole line, the part in place of
  -- the words. One undo brings the words back. The cursor stays at the end
  -- of a starter body, if the ghost text brought one.
  vim.lsp.commands["rubric.pin"] = function(command, ctx)
    local arg = command.arguments and command.arguments[1]
    if not arg then
      return
    end
    pcall(vim.cmd.undojoin)
    vim.api.nvim_buf_set_lines(ctx.bufnr, arg.line, arg.line + 1, false, { arg.text })
    local win = vim.fn.bufwinid(ctx.bufnr)
    if win ~= -1 and vim.api.nvim_win_get_cursor(win)[1] == arg.line + 1 then
      vim.api.nvim_win_set_cursor(win, { arg.line + 1, #arg.text })
    end
  end

  vim.api.nvim_create_autocmd("LspAttach", {
    group = vim.api.nvim_create_augroup("Rubric", { clear = true }),
    callback = function(event)
      local client = vim.lsp.get_client_by_id(event.data.client_id)
      if not client or client.name ~= "rubric" then
        return
      end
      vim.lsp.inline_completion.enable(true, { bufnr = event.buf })
      if opts.close then
        close_directive(event.buf)
      end
      reopen_completion(event.buf)
      watch_picks(event.buf)
      watch_spell(event.buf)
      send_cursor(event.buf, client.id)
      -- The line is done: ask now rather than after the pause.
      local function ask_now()
        local c = vim.lsp.get_client_by_id(client.id)
        if c then
          c:notify("rubric/ask", { uri = vim.uri_from_bufnr(event.buf) })
        end
      end
      vim.api.nvim_create_autocmd("InsertLeave", {
        group = vim.api.nvim_create_augroup("RubricAsk" .. event.buf, { clear = true }),
        buffer = event.buf,
        callback = function()
          ask_now()
          -- The ghost text goes with insert mode, and the page goes back to
          -- the first pick with it.
          local at = picks_at[event.buf]
          local c = vim.lsp.get_client_by_id(client.id)
          if at and c then
            c:notify("rubric/choose", { uri = vim.uri_from_bufnr(event.buf), line = at.line })
          end
          picks_at[event.buf] = nil
        end,
      })
      -- Typing on makes the ghost text wrong: it's for the words as they were.
      -- Neovim would keep it at the old end of the line, hide one letter of it
      -- per letter typed, and accept it there. So it goes with the first key.
      -- Neovim has no call to drop it, but accepting into nothing does, and
      -- also stops the request it was about to send, so that's sent again.
      vim.api.nvim_create_autocmd({ "TextChangedI", "TextChangedP" }, {
        group = vim.api.nvim_create_augroup("RubricStale" .. event.buf, { clear = true }),
        buffer = event.buf,
        callback = function()
          vim.lsp.inline_completion.get({
            bufnr = event.buf,
            on_accept = function()
              picks_at[event.buf] = nil
              vim.api.nvim_exec_autocmds("CursorMovedI", {
                group = "nvim.lsp.inline_completion:" .. event.buf,
                buffer = event.buf,
              })
            end,
          })
        end,
      })
      -- Moves the ghost text to another pick, and tells the server, so the
      -- preview shows the same one. Index from 0 for the server.
      local function move(count)
        clear_picks(event.buf)
        vim.lsp.inline_completion.select({ count = count })
        local at = picks_at[event.buf]
        local c = vim.lsp.get_client_by_id(client.id)
        if at and c then
          at.index = (at.index - 1 + count) % at.count + 1
          c:notify("rubric/choose", { uri = vim.uri_from_bufnr(event.buf), line = at.line, index = at.index - 1 })
        end
      end
      local function map(lhs, rhs, desc)
        vim.keymap.set("i", lhs, rhs, { buffer = event.buf, desc = desc })
      end
      map(opts.accept, function()
        if not vim.lsp.inline_completion.get() then
          ask_now()
        end
      end, "Rubric: accept and pin, or ask now")
      map(opts.next, function()
        move(1)
      end, "Rubric: next pick")
      map(opts.prev, function()
        move(-1)
      end, "Rubric: previous pick")
    end,
  })
end

return M
