-- Rubric for Neovim 0.12: the language server, ghost text and two keys.
--
--   vim.opt.runtimepath:append("/path/to/rubric/editors/nvim")
--   require("rubric").setup()
--
-- The server attaches only inside a Rubric site (a folder with rubric.md) and
-- only to Markdown. Ghost text is Neovim's own inline completion.

local M = {}
local themes = require("rubric.themes")
local drafts = require("rubric.drafts")
local starters = require("rubric.starters")

local defaults = {
  -- Accept the ghost text: pins the line. Before any ghost text shows, it
  -- asks Jev about the line at once instead of waiting for a pause. On
  -- rubric.md's `::: theme` line, it opens the theme list.
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
  -- What drafts a new part for a `::: new:` line unless another setup is
  -- chosen for one draft: a tool, "claude" (Claude Code) or "opencode"; a
  -- model, in the tool's own form ("opus"; "openai/gpt-6.1-sol"); and an
  -- effort, Claude Code's --effort or an OpenCode variant ("low", "high").
  -- No model or effort is the tool's default. A choice made with :Rubric
  -- harness or :Rubric model is kept and used instead, in every session,
  -- until :Rubric harness goes back to this one.
  draft = { harness = "claude", model = "opus", effort = "low" },
  -- How a draft is asked for: "fast", one turn with the files in the reply,
  -- or "tools", the tool writing them a turn a step. :Rubric tooluse
  -- (and :Rubric harness) changes it, and that choice is kept.
  drafting = "fast",
}

-- The parts that take nothing inside (`::: divider`), from the server: their
-- lines have no closing ":::", as the theme line has none.
local alone_parts = {}

local function set_alone(names)
  alone_parts = {}
  for _, n in ipairs(names or {}) do
    alone_parts[n] = true
  end
end

local plain_end

-- Is this a line with no block: the theme line, or a part that takes
-- nothing inside, in plain form (`::: search : a big one` too). Words that
-- start with such a part's name (`::: search for something`) open a block.
local function is_alone_line(line)
  if themes.is_theme_line(line) then
    return true
  end
  local from, name = line:match("^%s*:::+%s*()([%l%d-]+)")
  return name ~= nil and alone_parts[name] == true and plain_end(line, from) ~= nil
end

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
    elseif l:match("^%s*:::+%s*%S") and not is_alone_line(l) then
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
    if #lines == 2 then
      themes.mark_closer(bufnr, row)
    end
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
function plain_end(line, pos)
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

-- The columns of a directive line's plain form, as the scanner reads it: from
-- the colons to a lone ":", when the line starts with a part.
local function plain_span(line)
  local from = line:match("^%s*:::+%s*()%S")
  if not from then
    return nil
  end
  local stop = plain_end(line, from)
  if stop then
    return from, stop
  end
end

local function mark_plain(bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr, spell_ns, 0, -1)
  for row, line in ipairs(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)) do
    local start, stop
    if themes.is_theme_line(line) then
      -- Theme and piece names, all of it: `::: theme hyde-red palette=nord`.
      start, stop = line:match("^%s*:::+%s*()"), #line + 1
    else
      start, stop = plain_span(line)
    end
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

-- Lines with no block, and rubric.md's theme line.
--
-- The ":::" that typing "::: " put below goes once the line plainly has no
-- block: the theme line, or a part that takes nothing inside. "::: theme "
-- with its space can't become a part like theme-switch any more, so it goes
-- then; anything else waits for the writer to leave the line or insert
-- mode, since `::: search` may still become `::: search for something`,
-- words, which do get a block. Leaving by Enter puts an empty line between
-- the two, so the closer is looked for past it.
--
-- In rubric.md, with the cursor on the theme line, a hint at the end says
-- the accept key opens the list (the palette's, on `palette=`). On a
-- `::: new:` line in a page, it says the key is how a new part is drafted.
local theme_ns = vim.api.nvim_create_namespace("rubric.theme-hint")

local function watch_alone_lines(bufnr, accept, on_rubric_md)
  local function hint()
    vim.api.nvim_buf_clear_namespace(bufnr, theme_ns, 0, -1)
    if vim.api.nvim_get_current_buf() ~= bufnr then
      return
    end
    local row, col = unpack(vim.api.nvim_win_get_cursor(0))
    local line = vim.api.nvim_get_current_line()
    local text
    if on_rubric_md and themes.is_theme_line(line) then
      local key = themes.piece_at(line, col) or themes.piece_at(line, col - 1)
      text = ("  %s opens the %s list"):format(accept, key or "theme")
    else
      return
    end
    vim.api.nvim_buf_set_extmark(bufnr, theme_ns, row - 1, 0, {
      virt_text = { { text, "ComplHintMore" } },
      virt_text_pos = "eol",
      hl_mode = "combine",
    })
  end
  -- The line at `row` (0-based) is done: its closer goes if it has no block.
  -- `cursor` is the row the writer is on now, maybe a new empty one below.
  local function drop_done(row, cursor)
    local line = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1]
    if not line or not is_alone_line(line) then
      return
    end
    local below = vim.api.nvim_buf_get_lines(bufnr, row + 1, row + 2, false)[1]
    if cursor == row + 1 and below and below:match("^%s*$") then
      themes.drop_closer(bufnr, row + 1, open_blocks)
    else
      themes.drop_closer(bufnr, row, open_blocks)
    end
  end
  -- In insert mode: the row the cursor is on, and the buffer's change count
  -- when it got there. Only a line typed on is looked at: passing over one
  -- changes nothing. Counted rather than caught as it happens, since Neovim
  -- skips its events while keys are still waiting.
  local last, tick
  local function changed()
    return tick ~= vim.api.nvim_buf_get_changedtick(bufnr)
  end
  local function at(row)
    if last and last ~= row and changed() then
      drop_done(last, row)
    end
    if last ~= row then
      last, tick = row, vim.api.nvim_buf_get_changedtick(bufnr)
    end
  end
  local group = vim.api.nvim_create_augroup("RubricAlone" .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd({ "CursorMoved", "BufEnter" }, { group = group, buffer = bufnr, callback = hint })
  vim.api.nvim_create_autocmd("InsertEnter", {
    group = group,
    buffer = bufnr,
    callback = function()
      last, tick = vim.api.nvim_win_get_cursor(0)[1] - 1, vim.api.nvim_buf_get_changedtick(bufnr)
    end,
  })
  vim.api.nvim_create_autocmd("CursorMovedI", {
    group = group,
    buffer = bufnr,
    callback = function()
      at(vim.api.nvim_win_get_cursor(0)[1] - 1)
      hint()
    end,
  })
  -- Only while typing: the closer only ever comes from typing "::: ". In
  -- normal mode a change may be an undo, and taking the closer away again
  -- there would make a new change, so undo could never get past it.
  vim.api.nvim_create_autocmd({ "TextChangedI", "TextChangedP" }, {
    group = group,
    buffer = bufnr,
    callback = function()
      local row = vim.api.nvim_win_get_cursor(0)[1] - 1
      at(row)
      if vim.api.nvim_get_current_line():match("^%s*:::+%s*theme%s") then
        themes.drop_closer(bufnr, row, open_blocks)
      end
      hint()
    end,
  })
  vim.api.nvim_create_autocmd("TextChanged", { group = group, buffer = bufnr, callback = hint })
  vim.api.nvim_create_autocmd("InsertLeave", {
    group = group,
    buffer = bufnr,
    callback = function()
      local row = vim.api.nvim_win_get_cursor(0)[1] - 1
      at(row)
      if changed() then
        drop_done(row, row)
      end
      last, tick = nil, nil
      hint()
    end,
  })
  vim.api.nvim_create_autocmd("BufLeave", {
    group = group,
    buffer = bufnr,
    callback = function()
      vim.api.nvim_buf_clear_namespace(bufnr, theme_ns, 0, -1)
    end,
  })
  hint()
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

  -- The setup's choice, unless :Rubric harness or :Rubric model made
  -- one since, which is kept in Neovim's data folder.
  local chosen = drafts.drafter(defaults.draft, opts.draft)
  drafts.remember_setup(defaults.draft, opts.draft)
  drafts.set_keys({ accept = opts.accept, next = opts.next, prev = opts.prev })
  starters.set_accept(opts.accept)
  local draft_args = vim.list_extend(drafts.args(chosen), { "--drafting", drafts.drafting(opts.drafting) })
  vim.lsp.config("rubric", {
    cmd = vim.list_extend(vim.list_extend({ "bun", root .. "/src/cli.ts", "lsp" }, draft_args), opts.args),
    -- Bun loads .env from the working directory; the repo's holds TYPESAFE_API_KEY.
    cmd_cwd = root,
    filetypes = { "markdown" },
    root_markers = { "rubric.md" },
    capabilities = opts.capabilities,
    handlers = {
      ["rubric/picks"] = picks_handler(opts.next),
      -- hugo.toml named another theme, and its skin may bring other parts.
      ["rubric/alone"] = function(_, params)
        set_alone(params.parts)
      end,
      -- A new part's draft finished, or failed.
      ["rubric/drafted"] = drafts.drafted,
      ["rubric/starters"] = starters.handler,
    },
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
    -- The part picked takes nothing inside: the block's closer goes, with the
    -- empty lines in it; anything written there stays, as writing after it.
    local below = arg.drop and vim.api.nvim_buf_get_lines(ctx.bufnr, arg.drop, arg.drop + 1, false)[1]
    if below and below:match("^%s*:::+%s*$") then
      local inside = vim.api.nvim_buf_get_lines(ctx.bufnr, arg.line + 1, arg.drop, false)
      local from = table.concat(inside):match("^%s*$") and arg.line + 1 or arg.drop
      pcall(vim.cmd.undojoin)
      vim.api.nvim_buf_set_lines(ctx.bufnr, from, arg.drop + 1, false, {})
    end
    local win = vim.fn.bufwinid(ctx.bufnr)
    if win ~= -1 and vim.api.nvim_win_get_cursor(win)[1] == arg.line + 1 then
      vim.api.nvim_win_set_cursor(win, { arg.line + 1, #arg.text })
    end
    -- Nothing in the catalog fitted, and the writer took the offer of a new
    -- part: the line is a `new:` line now, and they choose how to draft it.
    local client = arg.build and vim.lsp.get_client_by_id(ctx.client_id)
    if client then
      drafts.act(client, ctx.bufnr, arg.line)
    end
  end

  -- :Rubric theme opens the theme list for rubric.md's theme line. :Rubric
  -- harness chooses the tool that drafts new parts, its model, how hard it
  -- thinks and whether it uses tools; :Rubric model another model for that
  -- tool, and :Rubric tooluse tools or none; all last across sessions.
  -- :Rubric log follows what the draft on the cursor's line is doing.
  local commands = { "theme", "harness", "model", "tooluse", "log" }
  vim.api.nvim_create_user_command("Rubric", function(cmd)
    if not vim.tbl_contains(commands, cmd.args) then
      vim.notify("rubric: :Rubric " .. table.concat(commands, ", :Rubric "), vim.log.levels.INFO)
      return
    end
    local bufnr = vim.api.nvim_get_current_buf()
    local client = vim.lsp.get_clients({ bufnr = bufnr, name = "rubric" })[1]
    if not client then
      vim.notify("rubric: the server is not running in this buffer", vim.log.levels.WARN)
      return
    end
    if cmd.args == "model" then
      drafts.choose_model(client, bufnr)
    elseif cmd.args == "harness" then
      drafts.choose_harness(client, bufnr)
    elseif cmd.args == "tooluse" then
      drafts.choose_tooluse(client, bufnr)
    elseif cmd.args == "log" then
      drafts.log(client, bufnr, vim.api.nvim_win_get_cursor(0)[1] - 1)
    else
      themes.command(bufnr, client, open_blocks)
    end
  end, {
    nargs = 1,
    complete = function(lead, line)
      local words = vim.split(line:gsub("^%S+%s*", ""), "%s+")
      local options = #words <= 1 and commands or {}
      return vim.tbl_filter(function(c)
        return vim.startswith(c, lead)
      end, options)
    end,
    desc = "Rubric: open the theme list, choose what drafts new parts, or follow a draft's log",
  })

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
      drafts.sync(client, event.buf, opts.drafting, chosen, defaults.draft, opts.draft)
      local experimental = client.server_capabilities.experimental
      set_alone(experimental and experimental.rubric and experimental.rubric.alone)
      local on_rubric_md = themes.is_rubric_md(event.buf)
      watch_alone_lines(event.buf, opts.accept, on_rubric_md)
      if not on_rubric_md then
        drafts.watch(event.buf)
        starters.watch(event.buf)
      end
      -- The list for the theme line the cursor is on, from either mode.
      local function open_theme()
        local c = vim.lsp.get_client_by_id(client.id)
        local row, col = unpack(vim.api.nvim_win_get_cursor(0))
        if c then
          vim.schedule(function()
            themes.open(event.buf, c, row - 1, col, open_blocks)
          end)
        end
      end
      local function on_theme_line()
        return on_rubric_md and themes.is_theme_line(vim.api.nvim_get_current_line())
      end
      local function on_new_line()
        return not on_rubric_md and drafts.is_new_line(vim.api.nvim_get_current_line())
      end
      -- A `::: new:` line: draft its part, or say what to do with the draft.
      local function act_new()
        local c = vim.lsp.get_client_by_id(client.id)
        local row = vim.api.nvim_win_get_cursor(0)[1] - 1
        if c then
          vim.schedule(function()
            drafts.act(c, event.buf, row)
          end)
        end
      end
      -- A line of the site's own part: another take of it, keep, or remove.
      local function own_line()
        return not on_rubric_md and starters.own_at(event.buf, vim.api.nvim_win_get_cursor(0)[1] - 1)
      end
      local function act_own()
        local c = vim.lsp.get_client_by_id(client.id)
        local row = vim.api.nvim_win_get_cursor(0)[1] - 1
        local s = starters.at(event.buf, row)
        if c then
          vim.schedule(function()
            drafts.act_own(c, event.buf, row, s and function()
              starters.fill(event.buf, s)
            end)
          end)
        end
      end
      -- Where the keys that move between picks move between takes instead.
      local function has_takes()
        if on_new_line() then
          return true
        end
        local o = own_line()
        return o and (o.takes or 0) > 1
      end
      -- Normal-mode keys do their own thing anywhere else on the page.
      local function normal(lhs, rhs, desc)
        vim.keymap.set("n", lhs, function()
          if rhs() then
            return ""
          end
          return lhs
        end, { buffer = event.buf, expr = true, desc = desc })
      end
      normal(opts.accept, function()
        if on_theme_line() then
          open_theme()
          return true
        elseif on_new_line() then
          act_new()
          return true
        end
        -- An empty block of a catalog part the site hasn't changed: its
        -- starter at once, as before; Change… once it has writing.
        local o = own_line()
        local row = vim.api.nvim_win_get_cursor(0)[1] - 1
        if o and not (o.catalog and not o.takes and starters.at(event.buf, row)) then
          act_own()
          return true
        end
        -- Anywhere in an empty block, its part's line too: its starter, filled in.
        local s = starters.at(event.buf, vim.api.nvim_win_get_cursor(0)[1] - 1)
        if s then
          vim.schedule(function()
            starters.fill(event.buf, s)
          end)
          return true
        end
      end, "Rubric: open the theme list, draft a new part, redraft the site's own part, or fill in a part's starter")
      -- On a `new:` line, the keys that move between picks move between takes.
      local function cycle(step)
        local c = vim.lsp.get_client_by_id(client.id)
        local row = vim.api.nvim_win_get_cursor(0)[1] - 1
        if c then
          drafts.cycle(c, event.buf, row, step)
        end
      end
      normal(opts.next, function()
        if has_takes() then
          vim.schedule(function()
            cycle(1)
          end)
          return true
        end
      end, "Rubric: the next take of a new part")
      normal(opts.prev, function()
        if has_takes() then
          vim.schedule(function()
            cycle(-1)
          end)
          return true
        end
      end, "Rubric: the take before, of a new part")
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
        if on_theme_line() then
          vim.cmd.stopinsert()
          open_theme()
          return
        end
        if on_new_line() then
          vim.cmd.stopinsert()
          act_new()
          return
        end
        -- Ghost text first: on the part's line, accepting a pick comes before
        -- filling in the starter.
        if vim.lsp.inline_completion.get() then
          return
        end
        -- A catalog part the site hasn't changed is changed from normal mode:
        -- here the key fills its starter or asks now, as on any line.
        local o = own_line()
        if o and not (o.catalog and not o.takes) then
          vim.cmd.stopinsert()
          act_own()
          return
        end
        local s = starters.at(event.buf, vim.api.nvim_win_get_cursor(0)[1] - 1)
        if s then
          starters.fill(event.buf, s)
          return
        end
        ask_now()
      end, "Rubric: accept and pin, ask now, open the theme list, draft a new part, or fill in a starter")
      map(opts.next, function()
        if has_takes() then
          cycle(1)
        else
          move(1)
        end
      end, "Rubric: next pick, or next take of a new part")
      map(opts.prev, function()
        if has_takes() then
          cycle(-1)
        else
          move(-1)
        end
      end, "Rubric: previous pick, or take before of a new part")
    end,
  })
end

return M
