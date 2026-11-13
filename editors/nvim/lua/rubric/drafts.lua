-- New parts, for a `::: new: what it should be` line (docs/plan.md, step 7).
--
-- The accept key on such a line does the next thing: starts a draft, or,
-- once one is drawn in the preview, asks keep, reroll or cancel, and on keep
-- whether every theme gets the part. Drafting takes a minute or two in the
-- server; the line's note says where it is, and a message says when it's
-- done. Keep, cancel and "use" answer with the line to put in place of the
-- `new:` line.

local M = {}

local NEW = "^%s*:::+%s*new:"

function M.is_new_line(line)
  return line ~= nil and line:match(NEW) ~= nil
end

-- Defined with the line's status, below.
local mark_kept

local function request(client, bufnr, row, params, done)
  params.uri = vim.uri_from_bufnr(bufnr)
  params.line = row
  client:request("rubric/draft", params, function(err, result)
    if err then
      vim.notify("rubric: " .. (err.message or tostring(err)), vim.log.levels.WARN)
      return
    end
    if done then
      done(result)
    end
  end, bufnr)
end

-- Where the `new:` line that read `text` is now: at `row` if it still is,
-- else wherever it moved while the server worked. Nil if it's gone.
local function find(bufnr, row, text)
  if vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1] == text then
    return row
  end
  for i, l in ipairs(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)) do
    if l == text then
      return i - 1
    end
  end
end

-- Puts the answer's line in place of the `new:` line that read `text`. A
-- part that takes nothing inside loses the block's closer too, with the
-- block's empty lines; anything written in it stays, as writing after it.
local function replace(bufnr, row, text, result)
  if not result then
    return
  end
  if result.error then
    vim.notify("rubric: " .. result.error, vim.log.levels.WARN)
    return
  end
  local at = result.replace and find(bufnr, row, text)
  if at then
    vim.api.nvim_buf_set_lines(bufnr, at, at + 1, false, { result.replace })
    local drop = result.drop and at + (result.drop - row)
    local below = drop and vim.api.nvim_buf_get_lines(bufnr, drop, drop + 1, false)[1]
    if below and below:match("^%s*:::+%s*$") then
      local inside = vim.api.nvim_buf_get_lines(bufnr, at + 1, drop, false)
      local from = table.concat(inside):match("^%s*$") and at + 1 or drop
      pcall(vim.cmd.undojoin)
      vim.api.nvim_buf_set_lines(bufnr, from, drop + 1, false, {})
    end
  end
  if at and result.part then
    mark_kept(bufnr, at, result.part, result.version ~= nil)
  end
  if result.version then
    vim.notify(("rubric: added to the catalog for every theme, version %d"):format(result.version), vim.log.levels.INFO)
  end
end

local function started(view)
  if view and view.status == "drafting" then
    vim.notify(("rubric: drafting “%s”"):format(view.words), vim.log.levels.INFO)
  end
end

function M.build(client, bufnr, row, params)
  request(client, bufnr, row, vim.tbl_extend("force", { action = "build" }, params or {}), started)
end

-- Menus open from the server's answer, outside any key the writer pressed:
-- out of insert mode, on the loop's next turn, and drawn at once, since a
-- picker (snacks) opened there can otherwise wait for the next key to show.
local function choose(items, prompt, on_choice, on_cancel)
  vim.schedule(function()
    if vim.api.nvim_get_mode().mode:sub(1, 1) == "i" then
      vim.cmd.stopinsert()
    end
    vim.ui.select(items, {
      prompt = prompt,
      format_item = function(item)
        return item.label
      end,
    }, function(item)
      if item then
        on_choice(item.value)
      elseif on_cancel then
        on_cancel()
      end
    end)
    vim.schedule(function()
      vim.cmd.redraw()
    end)
  end)
end

-- Defined with the drafters, below.
local reroll_menu, first_menu

-- A list whose entry under the cursor the page in the browser draws, as the
-- theme list does: snacks.nvim's picker when it is there, else a plain list,
-- which draws nothing until one is chosen. Each item has `value`, `label`
-- (the plain list's line), `text` (what the picker searches) and `chunks`
-- (the picker's line). `show(item)` draws one; `done(item)` gets the one
-- chosen, or nil on Esc. `at` is the entry the cursor starts on.
local function preview_list(title, items, show, done, at)
  vim.schedule(function()
    if vim.api.nvim_get_mode().mode:sub(1, 1) == "i" then
      vim.cmd.stopinsert()
    end
    local ok, snacks = pcall(require, "snacks")
    if not ok or not snacks.picker then
      vim.ui.select(items, {
        prompt = title,
        format_item = function(item)
          return item.label
        end,
      }, done)
      return
    end
    for i, item in ipairs(items) do
      item.idx = i
    end
    local chosen
    -- The picker reports its first entry as it opens, before the cursor is
    -- put where it starts: nothing is drawn until then, or the page would
    -- flash the first entry every time.
    local shown = false
    snacks.picker.pick({
      title = title,
      items = items,
      format = function(item)
        return item.chunks
      end,
      layout = { preset = "select" },
      on_show = function(picker)
        shown = true
        if at and at > 1 then
          pcall(function()
            picker.list:set_target(at)
          end)
        elseif items[1] then
          show(items[1])
        end
      end,
      on_change = function(_, item)
        if item and shown then
          show(item)
        end
      end,
      confirm = function(picker, item)
        chosen = item
        picker:close()
      end,
      on_close = function()
        vim.schedule(function()
          done(chosen)
        end)
      end,
    })
    vim.schedule(function()
      vim.cmd.redraw()
    end)
  end)
end

-- The parts the writer already has that are near a `new:` line's words,
-- their own first, each drawn where the line is, with the block's writing
-- in it, while the cursor is on it. `use(name)` puts the chosen one on the
-- line; Esc goes `back` to the menu it came from.
local function near_list(client, bufnr, row, near, use, back)
  local uri = vim.uri_from_bufnr(bufnr)
  local function show(item)
    client:notify("rubric/peek", { uri = uri, line = row, part = item and item.name or vim.NIL })
  end
  local items = {}
  for _, n in ipairs(near) do
    table.insert(items, {
      name = n.name,
      value = n.name,
      label = n.name .. (n.own and "  yours" or "") .. "  " .. n.description,
      text = n.name .. " " .. n.description,
      chunks = {
        { n.name, "SnacksPickerLabel" },
        { n.own and "  yours" or "", "DiagnosticOk" },
        { "  " .. n.description, "Comment" },
      },
    })
  end
  preview_list("Similar parts", items, show, function(item)
    if item then
      use(item.name)
    else
      show(nil)
      back()
    end
  end)
end

-- When a take was made: the time today, the day too before that.
local function made(at)
  local t = math.floor(at / 1000)
  return os.date(os.date("%Y%m%d", t) == os.date("%Y%m%d") and "%H:%M" or "%b %d %H:%M", t)
end

-- The takes of one line, oldest first, each with when it was made, what
-- drafted it and what it was asked to change; the page draws the one under
-- the cursor. Enter stays on it, Esc goes back to the take that was on
-- screen; either way `back` reopens the menu it came from.
local function takes_list(client, bufnr, row, view, back)
  local function show(item)
    request(client, bufnr, row, { action = "take", to = item.value })
  end
  local items = {}
  for i, t in ipairs(view.list or {}) do
    local what = t.original and "as kept" or ("take %d"):format(i)
    local rest = (t.by and ("  " .. t.by) or "") .. (t.change and ("  “" .. t.change .. "”") or "")
    local now = i == view.take and "  (now)" or ""
    table.insert(items, {
      value = i,
      label = ("%s  %s%s%s"):format(what, made(t.at), rest, now),
      text = what .. " " .. rest,
      chunks = {
        { what, "SnacksPickerLabel" },
        { "  " .. made(t.at), "Number" },
        { rest, "Comment" },
        { now, "DiagnosticOk" },
      },
    })
  end
  preview_list(("Takes (%d)"):format(#items), items, show, function(item)
    request(client, bufnr, row, { action = "take", to = item and item.value or view.take }, function()
      back()
    end)
  end, view.take)
end

-- The accept key on a `new:` line.
function M.act(client, bufnr, row)
  local text = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1]
  local function answer(params)
    request(client, bufnr, row, params, function(r)
      replace(bufnr, row, text, r)
    end)
  end
  -- Keep a draft: for this site, or for every theme.
  local function keep(name)
    choose({
      { label = "This site", value = false },
      { label = "Every theme", value = true },
    }, ("Keep %s for"):format(name), function(global)
      answer({ action = "keep", global = global })
    end)
  end
  request(client, bufnr, row, {}, function(view)
    if not view then
      return
    end
    if view.words == "" then
      vim.notify("rubric: new: needs words after it", vim.log.levels.INFO)
      return
    end
    local status = view.status
    -- Takes cancelled before, for the same words: bring them back, or start over.
    if status == nil and (view.earlier or 0) > 0 then
      local function earlier()
        local items = {
          { label = ("Earlier takes (%d)"):format(view.earlier), value = "restore" },
          { label = "New draft", value = "build" },
        }
        -- Parts the writer already has that may do, as in the first menu.
        local near = view.near
        if near and #near > 0 then
          table.insert(items, 1, {
            label = #near == 1 and ("Similar: %s"):format(near[1].name) or ("Similar parts (%d)"):format(#near),
            value = "look",
          })
        end
        choose(items, "Drafted before", function(v)
          if v == "look" then
            near_list(client, bufnr, row, near, function(name)
              answer({ action = "use", part = name })
            end, earlier)
          elseif v == "restore" then
            request(client, bufnr, row, { action = "restore" })
          else
            M.build(client, bufnr, row)
          end
        end)
      end
      earlier()
      return
    end
    -- A draft drawn while a reroll is made, or after one failed, can still be kept.
    local shown = view.shown or (status == "ready" and view.name) or nil
    local items = {}
    local function add(label, value)
      table.insert(items, { label = label, value = value })
    end
    if status == "ready" then
      add(("Keep %s"):format(view.name), "keep")
      if (view.takes or 0) > 1 then
        add(("Takes (%d)"):format(view.takes), "takes")
      end
      add("Reroll…", "reroll")
    elseif status == "drafting" then
      add("Wait", "wait")
      -- Taking too long: stop it, and keep what the line had before.
      add(shown and ("Stop, back to %s"):format(shown) or "Stop", "stop")
    else
      -- Nothing drafted yet: with the default, or another setup.
      if status == nil and not shown then
        local function first()
          first_menu(client, bufnr, view.drafter, function(d)
            M.build(client, bufnr, row, d and { drafter = d } or nil)
          end, function()
            answer({ action = "cancel" })
          end, view.near, function()
            near_list(client, bufnr, row, view.near, function(name)
              answer({ action = "use", part = name })
            end, first)
          end)
        end
        first()
        return
      end
      add(status == "failed" and "Retry" or "Draft", "build")
    end
    if shown and status ~= "ready" then
      add(("Keep %s"):format(shown), "keep")
    end
    if view.log then
      add("Log", "log")
    end
    add(status == "drafting" and "Cancel draft" or "Cancel", "cancel")
    local prompt = status == "ready" and ("%s, in the preview"):format(view.name)
      or status == "drafting" and "Drafting"
      or status == "failed" and ("Draft failed: %s"):format(view.message or "no reason given")
      or "New part"
    choose(items, prompt, function(v)
      if v == "keep" then
        keep(status == "ready" and view.name or shown)
      elseif v == "reroll" then
        reroll_menu(client, bufnr, view.name, view.drafter, nil, function(change, d)
          M.build(client, bufnr, row, { action = "reroll", change = change, drafter = d })
        end)
      elseif v == "takes" then
        takes_list(client, bufnr, row, view, function()
          M.act(client, bufnr, row)
        end)
      elseif v == "log" then
        M.show_log(view.log)
      elseif v == "build" then
        M.build(client, bufnr, row)
      elseif v == "cancel" or v == "stop" then
        answer({ action = v })
      end
    end)
  end)
end

-- The accept key on a line placing one of the site's own parts, a part a
-- `new:` line made and the writer kept: another take of it (which keeps its
-- name, so every page with it changes once kept), going back to it as it
-- was, putting it in the catalog for every theme, or taking it away. On a
-- catalog part's line: changing it for this site (`view.catalog`), which
-- makes it the site's own drawing of the part (`view.changed`), taken away
-- by going back to the catalog's.
-- `fill` fills in the block's starter, when it is empty.
function M.act_own(client, bufnr, row, fill)
  local text = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1]
  -- Words after a lone ":" are the change a reroll asks for, as the server
  -- reads them (a quoted value may hold a ":"); set from its answer below.
  local refine, colon
  local function done(r)
    if not r then
      return
    end
    if r.error then
      vim.notify("rubric: " .. r.error, vim.log.levels.WARN)
      return
    end
    local at = find(bufnr, row, text) or (colon and find(bufnr, row, (text:sub(1, colon):gsub("%s+$", ""))))
    if at and r.part then
      mark_kept(bufnr, at, r.part, r.version ~= nil)
    end
    if r.version then
      vim.notify(("rubric: added to the catalog for every theme, version %d"):format(r.version), vim.log.levels.INFO)
    end
    if r.removed then
      vim.notify(("rubric: removed; files in %s"):format(r.removed), vim.log.levels.INFO)
    end
  end
  -- To the line where it is now: it may have moved while a menu was open.
  local function answer(params)
    local at = find(bufnr, row, text)
    if not at then
      vim.notify("rubric: the line changed: press the key again", vim.log.levels.WARN)
      return
    end
    request(client, bufnr, at, params, done)
  end
  -- The words after ":" were the change, whatever it became: they go from
  -- the line as the reroll starts.
  local function reroll(change, d)
    local at = find(bufnr, row, text)
    if not at then
      vim.notify("rubric: the line changed: press the key again", vim.log.levels.WARN)
      return
    end
    if refine then
      vim.api.nvim_buf_set_lines(bufnr, at, at + 1, false, { (text:sub(1, colon):gsub("%s+$", "")) })
    end
    M.build(client, bufnr, at, { action = "reroll", change = change, drafter = d })
  end
  request(client, bufnr, row, {}, function(view)
    if not view or not view.of then
      return
    end
    if type(view.change) == "table" then
      refine, colon = view.change.words, view.change.colon
    end
    local name, status = view.of, view.status
    -- The catalog's part or the site's drawing of it: kept for this site only.
    local shared = view.catalog or view.changed
    local items = {}
    local function add(label, value)
      table.insert(items, { label = label, value = value })
    end
    if fill then
      add("Fill starter", "fill")
    end
    -- The first take is the part as it was kept.
    local original = (view.take or 1) == 1
    if status == "drafting" then
      add("Wait", "wait")
      add("Stop", "stop")
    end
    -- A take on screen can be kept even while another drafts or after one failed.
    if not original and (status == "ready" or view.shown) then
      add("Keep this take", "keep")
    end
    if (view.takes or 0) > 1 then
      add(("Takes (%d)"):format(view.takes), "takes")
    end
    if view.catalog and status == nil then
      add("Change…", "change")
    elseif status ~= "drafting" then
      add(status == "failed" and "Retry…" or "Reroll…", "reroll")
    end
    if status == nil and view.changed then
      add(("Back to the catalog's %s"):format(name), "remove")
    elseif status == nil and not shared then
      add(("Add %s to every theme"):format(name), "global")
      add(("Remove %s from this site…"):format(name), "remove")
    end
    if view.log then
      add("Log", "log")
    end
    if status ~= nil then
      add(view.catalog and ("Back to the catalog's %s"):format(name) or ("Back to %s as kept"):format(name), "cancel")
    end
    local kept = view.catalog and ("the catalog's %s"):format(name) or ("%s as kept"):format(name)
    local prompt = status == "drafting" and ("Drafting a take of %s"):format(name)
      or status == "failed" and ("Take of %s failed: %s"):format(name, view.message or "no reason given")
      or status == "ready" and (original and kept or ("Take %d of %s, in the preview"):format(view.take, name))
      or view.catalog and ("%s, catalog part"):format(name)
      or view.changed and ("%s, changed for this site"):format(name)
      or ("%s, site part"):format(name)
    choose(items, prompt, function(v)
      if v == "fill" then
        fill()
      elseif v == "keep" and shared then
        answer({ action = "keep", global = false })
      elseif v == "change" then
        -- What to change, then the draft starts with the default drafter.
        vim.ui.input({ prompt = ("Change %s: "):format(name), default = refine or "" }, function(notes)
          if notes and notes ~= "" then
            reroll(notes)
          end
        end)
      elseif v == "remove" and view.changed then
        answer({ action = "remove" })
      elseif v == "keep" then
        choose({
          { label = "This site", value = false },
          { label = "Every theme", value = true },
        }, ("Keep %s for"):format(name), function(global)
          answer({ action = "keep", global = global })
        end)
      elseif v == "global" then
        answer({ action = "keep", global = true })
      elseif v == "remove" then
        local uses = view.uses or { blocks = 0, pages = 0 }
        local prompt = uses.blocks > 0
            and ("Remove %s: used by %d other block%s on %d page%s, which will show as unknown"):format(
              name, uses.blocks, uses.blocks == 1 and "" or "s", uses.pages, uses.pages == 1 and "" or "s")
          or ("Remove %s: files go to .rubric/logs/removed/"):format(name)
        choose({
          { label = "Keep", value = false },
          { label = "Remove", value = true },
        }, prompt, function(yes)
          if yes then
            answer({ action = "remove" })
          end
        end)
      elseif v == "reroll" then
        -- The words after ":" are the notes it starts with.
        reroll_menu(client, bufnr, name, view.drafter, refine, reroll)
      elseif v == "takes" then
        takes_list(client, bufnr, row, view, function()
          M.act_own(client, bufnr, row, fill)
        end)
      elseif v == "log" then
        M.show_log(view.log)
      elseif v == "stop" or v == "cancel" then
        answer({ action = v })
      end
    end)
  end)
end

-- Moves the preview to the next take of the `new:` line (1) or the one
-- before (-1).
function M.cycle(client, bufnr, row, step)
  request(client, bufnr, row, { action = "take", step = step }, function(view)
    if view and (view.takes or 0) < 2 then
      vim.notify("rubric: one take only", vim.log.levels.INFO)
    end
  end)
end

-- ── The draft's log ─────────────────────────────────────────────────────

-- Opens a draft's log in a split below, read only, and follows it as the
-- draft writes to it: new lines appear, and the view stays at the end
-- unless the writer moved up to read.
function M.show_log(path)
  if not path or vim.fn.filereadable(path) == 0 then
    vim.notify("rubric: no log yet", vim.log.levels.INFO)
    return
  end
  local from = vim.api.nvim_get_current_win()
  vim.cmd("silent botright 12split " .. vim.fn.fnameescape(path))
  local win, buf = vim.api.nvim_get_current_win(), vim.api.nvim_get_current_buf()
  vim.bo[buf].readonly = true
  vim.bo[buf].modifiable = false
  vim.bo[buf].autoread = true
  vim.bo[buf].swapfile = false
  vim.bo[buf].bufhidden = "wipe"
  vim.api.nvim_win_set_cursor(win, { vim.api.nvim_buf_line_count(buf), 0 })
  vim.api.nvim_set_current_win(from)
  local follow = assert(vim.uv.new_timer())
  local function done()
    if not follow:is_closing() then
      follow:stop()
      follow:close()
    end
  end
  follow:start(500, 500, vim.schedule_wrap(function()
    if not vim.api.nvim_buf_is_valid(buf) then
      return done()
    end
    -- The draft was kept or cancelled, and its folder went with it.
    if vim.fn.filereadable(path) == 0 then
      return done()
    end
    local count = vim.api.nvim_buf_line_count(buf)
    local shows = vim.api.nvim_win_is_valid(win) and vim.api.nvim_win_get_buf(win) == buf
    local at_end = shows and vim.api.nvim_win_get_cursor(win)[1] >= count
    vim.api.nvim_buf_call(buf, function()
      vim.cmd("silent! checktime")
    end)
    if at_end then
      vim.api.nvim_win_set_cursor(win, { vim.api.nvim_buf_line_count(buf), 0 })
    end
  end))
  vim.api.nvim_create_autocmd("BufWipeout", { buffer = buf, once = true, callback = done })
end

-- :Rubric log, for the draft on the cursor's line.
function M.log(client, bufnr, row)
  request(client, bufnr, row, {}, function(view)
    if not view then
      vim.notify("rubric: not a new: line or a site part's line", vim.log.levels.INFO)
    elseif view.log then
      M.show_log(view.log)
    else
      vim.notify("rubric: no draft yet", vim.log.levels.INFO)
    end
  end)
end

-- ── What drafts: a tool, a model and an effort ──────────────────────────
--
-- The writer's default drafts every new part and reroll unless another is
-- chosen for one draft alone, in the setup list a draft or reroll offers.
-- A drafter is a tool ("claude" or "opencode"), a model in the tool's own
-- form, and how hard it thinks: Claude Code's effort, or an OpenCode
-- variant. No model or effort is the tool's default.

-- The default chosen with :Rubric harness or :Rubric model, and the
-- drafters used lately, kept in Neovim's data folder so they last across
-- sessions without touching the writer's config.
local saved_file = vim.fn.stdpath("data") .. "/rubric/draft.json"
local RECENT = 4

local function valid(d)
  if type(d) ~= "table" or (d.harness ~= "claude" and d.harness ~= "opencode") then
    return nil
  end
  return {
    harness = d.harness,
    model = type(d.model) == "string" and d.model or nil,
    effort = type(d.effort) == "string" and d.effort or nil,
  }
end

local function same(a, b)
  return a and b and a.harness == b.harness and a.model == b.model and a.effort == b.effort
end

-- Whether drafts are made with tools, the slower way. Every label that
-- names a drafter says so, since it changes how long each draft takes.
local tools_now = false

-- A drafter in a few words: "sonnet, low", or "sonnet, low, tools".
local function short(d)
  return ("%s%s%s"):format(d.model or (d.harness .. "'s default"), d.effort and (", " .. d.effort) or "", tools_now and ", tools" or "")
end

-- The saved default and recent drafters. Older files are read too: one
-- choice made for everything, or a fast and a careful one; what they chose
-- becomes a recent drafter, and a fast one the default.
function M.load_saved()
  local ok, text = pcall(vim.fn.readfile, saved_file)
  if not ok then
    return { recent = {} }
  end
  local ok2, saved = pcall(vim.json.decode, table.concat(text, "\n"))
  if not ok2 or type(saved) ~= "table" then
    return { recent = {} }
  end
  local out = { recent = {}, drafting = (saved.drafting == "fast" or saved.drafting == "tools") and saved.drafting or nil }
  if saved.harness then
    table.insert(out.recent, valid(saved))
  elseif saved.fast or saved.careful then
    out.default = valid(saved.fast)
    table.insert(out.recent, valid(saved.careful))
  else
    out.default = valid(saved.default)
    for _, d in ipairs(type(saved.recent) == "table" and saved.recent or {}) do
      table.insert(out.recent, valid(d))
    end
  end
  out.recent = vim.tbl_filter(function(d)
    return d ~= nil
  end, out.recent)
  return out
end

local function write_saved(saved)
  if not saved.default and #saved.recent == 0 and not saved.drafting then
    pcall(vim.fn.delete, saved_file)
    return
  end
  vim.fn.mkdir(vim.fs.dirname(saved_file), "p")
  vim.fn.writefile({ vim.json.encode({ default = saved.default, recent = saved.recent, drafting = saved.drafting }) }, saved_file)
end

-- A drafter used, first among the recent ones.
local function remember(d)
  local saved = M.load_saved()
  local recent = { d }
  for _, r in ipairs(saved.recent) do
    if not same(r, d) and #recent < RECENT then
      table.insert(recent, r)
    end
  end
  saved.recent = recent
  write_saved(saved)
end

-- A drafter from the setup, which may leave the tool out: Claude Code.
function M.from_setup(d)
  if type(d) ~= "table" then
    return nil
  end
  return valid(vim.tbl_extend("force", { harness = "claude" }, d))
end

-- What drafts when the server starts: the default chosen in the editor,
-- whole, when there is one; else the setup's; else the built-in one. A saved
-- choice of a tool's default model has no model, and must not take the
-- setup's.
function M.drafter(defaults, setup)
  return M.load_saved().default or M.from_setup(setup) or defaults
end

-- How drafts are asked for when the server starts: what :Rubric tooluse
-- chose, else the setup's, "fast" (one call with no tools, the files in the
-- reply) or "tools" (the tool writes them, a turn a step).
function M.drafting(setup)
  local mode = M.load_saved().drafting or ((setup == "fast" or setup == "tools") and setup or "fast")
  tools_now = mode == "tools"
  return mode
end

-- A server starts with the mode and the drafter the setup had when Neovim
-- opened, so each one is told the kept ones as it attaches: after a
-- restart, or in another site, the labels and the drafts agree.
-- `started` is the drafter the server's command line names: when the kept
-- one is still that, nothing is sent, so no tool is asked for its models.
function M.sync(client, bufnr, setup, started, defaults, draft_setup)
  client:request("rubric/drafting", { mode = M.drafting(setup) }, function() end, bufnr)
  local d = M.drafter(defaults, draft_setup)
  local same = d and started and d.harness == started.harness and d.model == started.model and d.effort == started.effort
  if d and not same then
    client:request("rubric/setDrafter", { harness = d.harness, model = d.model, effort = d.effort }, function() end, bufnr)
  end
end

-- With tools or without: a list like the model's, with the one in use marked.
local function pick_tools(done, back)
  choose({
    { label = "No tools: one call, files in the reply" .. (tools_now and "" or "  (now)"), value = "fast" },
    { label = "Tools: the tool writes the files, slower" .. (tools_now and "  (now)" or ""), value = "tools" },
  }, "Tool use", done, back)
end

-- The server takes the mode for drafts from now on, and it is kept for
-- every session.
local function set_tools(client, bufnr, mode, done)
  client:request("rubric/drafting", { mode = mode }, function(e, r)
    if e or not r or r.error then
      vim.notify("rubric: " .. ((r and r.error) or (e and e.message) or "could not change it"), vim.log.levels.WARN)
      return
    end
    local saved = M.load_saved()
    saved.drafting = r.mode
    write_saved(saved)
    tools_now = r.mode == "tools"
    done()
  end, bufnr)
end

-- :Rubric tooluse: whether a draft is one call with no tools or the tool
-- writing the files.
function M.choose_tooluse(client, bufnr)
  client:request("rubric/drafting", {}, function(err, now)
    if err or not now or not now.mode then
      vim.notify("rubric: " .. ((err and err.message) or "no answer from the server"), vim.log.levels.WARN)
      return
    end
    tools_now = now.mode == "tools"
    pick_tools(function(mode)
      set_tools(client, bufnr, mode, function()
        vim.notify("rubric: tool use: " .. (tools_now and "tools" or "no tools"), vim.log.levels.INFO)
      end)
    end)
  end, bufnr)
end

-- The server's command line for it.
function M.args(d)
  local args = { "--harness", d.harness }
  if d.model then
    vim.list_extend(args, { "--model", d.model })
  end
  if d.effort then
    vim.list_extend(args, { "--effort", d.effort })
  end
  return args
end

-- The setup's own choice, for :Rubric harness to go back to.
local setup_choice
function M.remember_setup(defaults, setup)
  setup_choice = M.from_setup(setup) or defaults
end

-- `mode`, when given, is set once the server has taken the drafter, so a
-- refused drafter changes nothing.
local function set_default(client, bufnr, d, back, mode)
  client:request("rubric/setDrafter", { harness = d.harness, model = d.model, effort = d.effort }, function(e, r)
    if e or (r and r.error) then
      vim.notify("rubric: " .. ((r and r.error) or (e and e.message) or "could not change it"), vim.log.levels.WARN)
      return
    end
    local saved = M.load_saved()
    saved.default = not back and d or nil
    write_saved(saved)
    if not back then
      remember(d)
    end
    local function say()
      vim.notify(("rubric: drafter: %s, %s"):format(r.drafter, tools_now and "with tools" or "no tools"), vim.log.levels.INFO)
    end
    if mode then
      set_tools(client, bufnr, mode, say)
    else
      say()
    end
  end, bufnr)
end

-- How hard the chosen model thinks, when it can be told: its default first.
local function pick_effort(client, bufnr, harness, model, current, done, back)
  client:request("rubric/drafter", { harness = harness, model = model }, function(err, r)
    local offered = (not err and r and r.efforts) or {}
    local d = { harness = harness, model = model }
    if #offered == 0 then
      done(d)
      return
    end
    local items = { { label = "default effort", value = "default" } }
    for _, level in ipairs(offered) do
      table.insert(items, { label = level == current and (level .. "  (now)") or level, value = level })
    end
    choose(items, ("How hard should %s think?"):format(model or harness), function(level)
      d.effort = level ~= "default" and level or nil
      done(d)
    end, back)
  end, bufnr)
end

-- The models one tool offers, its own default first, then how hard it thinks.
local function pick_model(client, bufnr, harness, now, done, back)
  client:request("rubric/drafter", { harness = harness }, function(err, r)
    if err or not r then
      vim.notify("rubric: " .. (err and err.message or "no answer from the server"), vim.log.levels.WARN)
      return
    end
    if r.error then
      vim.notify(("rubric: could not reach %s: %s"):format(harness, r.error), vim.log.levels.WARN)
      return
    end
    -- Drafts don't read OpenCode's config, so its default is its own, not the config's.
    local items = { { label = harness == "opencode" and "OpenCode default (config not read)" or "default model", value = "default" } }
    -- The model measured as the quickest good one for this tool, first.
    local first = r.suggested ~= vim.NIL and r.suggested or nil
    if first then
      table.insert(items, 1, { label = first .. "  (suggested)" .. (first == now.model and "  (now)" or ""), value = first })
    end
    for _, m in ipairs(r.models or {}) do
      if m ~= first then
        table.insert(items, { label = m == now.model and (m .. "  (now)") or m, value = m })
      end
    end
    choose(items, ("%s with which model? (%d)"):format(harness, #items - 1), function(m)
      local model = m ~= "default" and m or nil
      pick_effort(client, bufnr, harness, model, model == now.model and now.effort or nil, done, back)
    end, back)
  end, bufnr)
end

-- Which tool (it has to be installed), then its model and effort. `extra`
-- adds items of the caller's own at the end, by value.
local function pick_tool(client, bufnr, prompt, extra, done, other, back)
  client:request("rubric/harnesses", {}, function(err, list)
    if err or not list then
      vim.notify("rubric: " .. (err and err.message or "no answer from the server"), vim.log.levels.WARN)
      return
    end
    local labels = { claude = "Claude Code", opencode = "OpenCode" }
    local versions = {}
    local items = vim.tbl_map(function(h)
      local version = h.version ~= vim.NIL and h.version or nil
      versions[h.name] = version
      return { value = h.name, label = ("%s  %s"):format(labels[h.name] or h.name, version or "(not installed)") }
    end, list)
    vim.list_extend(items, extra or {})
    choose(items, prompt, function(v)
      if versions[v] then
        pick_model(client, bufnr, v, {}, done, back)
      elseif labels[v] then
        vim.notify(("rubric: %s not found on the PATH"):format(labels[v]), vim.log.levels.WARN)
        if back then
          back()
        end
      elseif other then
        other(v)
      end
    end, back)
  end, bufnr)
end

-- :Rubric harness: the default's tool, model and effort, then whether it
-- drafts with tools; or the setup's choice again.
function M.choose_harness(client, bufnr)
  local extra = setup_choice and {
    { value = "setup", label = ("From setup (%s)"):format(short(setup_choice)) },
  } or {}
  pick_tool(client, bufnr, "Default drafter", extra, function(d)
    pick_tools(function(mode)
      set_default(client, bufnr, d, false, mode)
    end)
  end, function()
    set_default(client, bufnr, setup_choice, true)
  end)
end

-- :Rubric model: another model and effort for the default's tool.
function M.choose_model(client, bufnr)
  client:request("rubric/drafter", {}, function(err, now)
    if err or not now then
      vim.notify("rubric: " .. (err and err.message or "no answer from the server"), vim.log.levels.WARN)
      return
    end
    local current = { model = now.model ~= vim.NIL and now.model or nil, effort = now.effort ~= vim.NIL and now.effort or nil }
    pick_model(client, bufnr, now.harness, current, function(d)
      set_default(client, bufnr, d)
    end)
  end, bufnr)
end

-- A drafter for one draft alone: the default, the ones used lately, or
-- another tool or model. `done(d)` gets nil for the default; Esc anywhere
-- in it goes `back`.
local function pick_once(client, bufnr, chosen, done, back)
  client:request("rubric/drafter", {}, function(err, now)
    if err or not now then
      vim.notify("rubric: " .. (err and err.message or "no answer from the server"), vim.log.levels.WARN)
      return
    end
    local default = { harness = now.harness, model = now.model ~= vim.NIL and now.model or nil, effort = now.effort ~= vim.NIL and now.effort or nil }
    local items = { { label = short(default) .. "  (default)", value = 0 } }
    local recent = vim.tbl_filter(function(d)
      return not same(d, default)
    end, M.load_saved().recent)
    for i, d in ipairs(recent) do
      table.insert(items, { label = short(d) .. (same(d, chosen) and "  (chosen)" or "") .. ("  · %s"):format(d.harness), value = i })
    end
    table.insert(items, { label = "Other…", value = "other" })
    choose(items, "Drafter", function(v)
      if v == 0 then
        done(nil)
      elseif v == "other" then
        pick_tool(client, bufnr, "Drafter", {}, done, nil, back)
      else
        done(recent[v])
      end
    end, back)
  end, bufnr)
end

-- What a reroll changes, before it starts: notes on what to change and the
-- drafter, for this one alone, kept in `state`. Once either is set, the
-- list gains Reroll, which `start`s it from here. Back (or Esc) goes `back`
-- to the menu before, which starts it too.
local function changes(client, bufnr, prompt, default, state, start, back)
  local function show()
    local items = {
      { label = ("Notes: %s…"):format(state.notes and ("“" .. state.notes .. "”") or "none"), value = "notes" },
      { label = ("Drafter: %s…"):format(state.drafter and short(state.drafter) or ((default or "default") .. " (default)")), value = "drafter" },
      { label = "Back", value = "back" },
    }
    if state.notes or state.drafter then
      table.insert(items, 1, { label = "Reroll", value = "start" })
    end
    choose(items, prompt, function(v)
      if v == "start" then
        start()
      elseif v == "notes" then
        vim.ui.input({ prompt = "Change: ", default = state.notes or "" }, function(text)
          if text then
            state.notes = text ~= "" and text or nil
          end
          show()
        end)
      elseif v == "drafter" then
        pick_once(client, bufnr, state.drafter, function(d)
          state.drafter = d
          show()
        end, show)
      else
        back()
      end
    end, back)
  end
  show()
end

-- Reroll: as it is, or with notes and a drafter chosen first; the changes'
-- own list starts it once there is one, and so does this one, whose entry
-- then names them. `notes` are words the line already has
-- for the change.
function reroll_menu(client, bufnr, name, default, notes, go)
  local state = { notes = notes, drafter = nil }
  local prompt = ("Reroll %s"):format(name)
  local function start()
    -- Used, so it's among the recent ones from now on.
    if state.drafter then
      remember(state.drafter)
    end
    go(state.notes or "", state.drafter)
  end
  local function show()
    local with = (state.drafter and (" with " .. short(state.drafter)) or "") .. (state.notes and (": “" .. state.notes .. "”") or "")
    choose({
      { label = "Reroll" .. with, value = "just" },
      { label = "Make changes…", value = "change" },
    }, prompt, function(v)
      if v == "just" then
        start()
      else
        changes(client, bufnr, prompt, default, state, start, show)
      end
    end)
  end
  show()
end

-- A first draft: with the default, or with another drafter for this one.
-- `near` are parts the writer already has that may do; `look` lists them.
function first_menu(client, bufnr, default, go, cancel, near, look)
  local drafter
  local function show()
    local items = {
      { label = ("Draft (%s)"):format(drafter and short(drafter) or default or "default"), value = "draft" },
      { label = "Draft with…", value = "setup" },
      { label = "Cancel", value = "cancel" },
    }
    if near and #near > 0 then
      table.insert(items, 1, {
        label = #near == 1 and ("Similar: %s"):format(near[1].name) or ("Similar parts (%d)"):format(#near),
        value = "look",
      })
    end
    choose(items, "New part", function(v)
      if v == "look" then
        look()
      elseif v == "draft" then
        if drafter then
          remember(drafter)
        end
        go(drafter)
      elseif v == "setup" then
        -- Another drafter for this one: chosen, then back here to start it.
        pick_once(client, bufnr, drafter, function(d)
          drafter = d
          show()
        end, show)
      else
        cancel()
      end
    end)
  end
  show()
end

-- ── Where each draft is, on its line ────────────────────────────────────
--
-- On a line of its own under the `new:` line (the block's bracket and wash
-- are below): a spinner and the time while it's drafted, a diamond with the keys once
-- it's drawn in the preview, a cross when it failed, an arrow when the
-- catalog has the part already, and, for a few seconds after keeping it, a
-- check with the settings the part takes. Drawn from the line's note, whose
-- data says where its draft is, so it is right after a restart too.

local status_ns = vim.api.nvim_create_namespace("rubric.drafting")
-- Where a kept part's line is, as lines above it change.
local kept_ns = vim.api.nvim_create_namespace("rubric.kept")
-- Shapes that sit at mid-height, level with the text beside them and with
-- the other marks (◆ ✗ ↪); braille dots hang at the top of the cell.
local SPIN = { "◐", "◓", "◑", "◒" }
local accept_key, next_key, prev_key = "<M-l>", "<M-n>", "<M-p>"
local kept = {}
local timer, frame = nil, 1

function M.set_accept(key)
  accept_key = key
end

function M.set_keys(keys)
  accept_key = keys.accept or accept_key
  next_key = keys.next or next_key
  prev_key = keys.prev or prev_key
end

local function clock(started)
  if not started then
    return ""
  end
  local secs = math.max(0, os.time() - math.floor(started / 1000))
  return (" · %d:%02d"):format(math.floor(secs / 60), secs % 60)
end

-- ── How a `new:` block looks ────────────────────────────────────────────
--
-- A `new:` block is a request, not writing, so it reads apart from the
-- page: a bracket in the gutter from its opening line to its closer, a faint
-- wash of the state's color behind it, and the `new:` label in that color.
-- The color says where the draft is: gray before it starts, blue while it
-- drafts or when the catalog has one, green when a take is ready, amber when
-- it failed. What to do next is on a line of its own under the opening line.

local TONES = { none = "Comment", info = "DiagnosticInfo", ok = "DiagnosticOk", warn = "DiagnosticWarn" }

local function color(group, attr)
  local ok, hl = pcall(vim.api.nvim_get_hl, 0, { name = group, link = false })
  return ok and hl and hl[attr] or nil
end

-- `a` toward `b` by `t`, as 0xRRGGBB numbers.
local function mix(a, b, t)
  local function ch(x, shift)
    return math.floor(x / 2 ^ shift) % 256
  end
  local out = 0
  for _, shift in ipairs({ 16, 8, 0 }) do
    out = out + math.floor(ch(a, shift) + (ch(b, shift) - ch(a, shift)) * t + 0.5) * 2 ^ shift
  end
  return out
end

local function define_looks()
  local bg = color("Normal", "bg")
  for tone, group in pairs(TONES) do
    local name = tone:sub(1, 1):upper() .. tone:sub(2)
    local fg = color(group, "fg")
    vim.api.nvim_set_hl(0, "RubricNewBar" .. name, { fg = fg, default = true })
    vim.api.nvim_set_hl(0, "RubricNewLabel" .. name, { fg = fg, bold = true, default = true })
    -- Without a background to mix with (a transparent one), the bracket and
    -- label carry it alone.
    vim.api.nvim_set_hl(0, "RubricNewBlock" .. name, (bg and fg) and { bg = mix(bg, fg, tone == "none" and 0.06 or 0.09), default = true } or { default = true })
  end
end
define_looks()
vim.api.nvim_create_autocmd("ColorScheme", {
  group = vim.api.nvim_create_augroup("RubricNewLooks", { clear = true }),
  callback = function()
    for tone in pairs(TONES) do
      local name = tone:sub(1, 1):upper() .. tone:sub(2)
      for _, kind in ipairs({ "Bar", "Label", "Block" }) do
        pcall(vim.api.nvim_set_hl, 0, "RubricNew" .. kind .. name, {})
      end
    end
    define_looks()
  end,
})

-- What one line shows, from its note's data: the mark under the line, what
-- it says, its tone, and whether it moves.
local function looks(d)
  local data = d.user_data and d.user_data.lsp and d.user_data.lsp.data
  if type(data) ~= "table" then
    return nil
  end
  local takes = type(data.takes) == "number" and data.takes > 1
      and (" · take %d of %d · %s %s other takes"):format(data.take, data.takes, prev_key, next_key)
    or ""
  -- Another take of the site's own part.
  if type(data.of) == "string" then
    if d.code == "drafting" then
      return SPIN[frame], ("drafting another take of %s%s · %s stop or go back"):format(data.of, clock(data.started), accept_key), "info", true
    elseif d.code == "draft-ready" then
      local which = data.take == 1 and ("%s as it was kept"):format(data.of) or ("take %d of %s"):format(data.take or 1, data.of)
      return "◆", ("%s%s · %s keep, reroll, go back"):format(which, takes:gsub("^ · take %d+ of %d+", ""), accept_key), "ok"
    elseif d.code == "draft-failed" then
      return "✗", ("another take of %s failed%s · %s try again or go back"):format(data.of, takes, accept_key), "warn"
    end
    return nil
  end
  if d.code == "drafting" then
    local also = data.shown and (" · %s still shown"):format(data.shown) or ""
    return SPIN[frame], ("drafting%s%s · %s stop or cancel"):format(clock(data.started), also, accept_key), "info", true
  elseif d.code == "draft-ready" then
    -- The settings it takes, by name: their values are in the line's note.
    local names = {}
    for _, s in ipairs(data.settings or {}) do
      table.insert(names, s.name)
    end
    local sets = #names > 0 and (" · takes " .. table.concat(names, ", ")) or ""
    return "◆", ("%s drafted%s%s · %s keep, reroll, cancel"):format(data.name or "part", takes, sets, accept_key), "ok"
  elseif d.code == "draft-failed" then
    return "✗", ("draft failed%s · %s try again"):format(takes, accept_key), "warn"
  elseif d.code == "new-part" and data.status == "none" then
    if type(data.earlier) == "number" and data.earlier > 0 then
      return "+", ("%s bring back %d earlier take%s, or draft a new part"):format(accept_key, data.earlier, data.earlier == 1 and "" or "s"), "none"
    end
    return "+", ("%s draft a new part"):format(accept_key), "none"
  end
end

-- The status goes on lines of its own under the line, so a long line never
-- pushes it out of sight; broken at spaces to fit the window.
local INDENT = "    "
local function under(bufnr, text, hl)
  local win = vim.fn.bufwinid(bufnr)
  -- Virtual lines start after the number, sign and fold columns, and never wrap.
  local info = win ~= -1 and vim.fn.getwininfo(win)[1] or nil
  local width = (info and (info.width - info.textoff) or vim.o.columns - 8) - #INDENT - 1
  width = math.max(width, 20)
  local lines, line = {}, ""
  for word in text:gmatch("%S+") do
    local next = line == "" and word or (line .. " " .. word)
    if vim.fn.strdisplaywidth(next) > width and line ~= "" then
      table.insert(lines, { { INDENT .. line, hl } })
      next = "  " .. word
    end
    line = next
  end
  table.insert(lines, { { INDENT .. line, hl } })
  return lines
end

-- The bracket, wash and label for a block from `first` to `last`.
local function mark_block(bufnr, first, last, tone)
  local name = tone:sub(1, 1):upper() .. tone:sub(2)
  local count = vim.api.nvim_buf_line_count(bufnr)
  last = math.min(last, count - 1)
  for row = first, last do
    local bar = first == last and "▏" or row == first and "╭" or row == last and "╰" or "│"
    pcall(vim.api.nvim_buf_set_extmark, bufnr, status_ns, row, 0, {
      sign_text = bar,
      sign_hl_group = "RubricNewBar" .. name,
      line_hl_group = "RubricNewBlock" .. name,
      priority = 20,
    })
  end
  local text = vim.api.nvim_buf_get_lines(bufnr, first, first + 1, false)[1] or ""
  local s, e = text:find("new:", 1, true)
  if s then
    pcall(vim.api.nvim_buf_set_extmark, bufnr, status_ns, first, s - 1, { end_col = e, hl_group = "RubricNewLabel" .. name, priority = 200 })
  end
end

-- The notes on `new:` lines carry where the draft is, which the block's own
-- look shows; underlined too, the request would read as a mistake. Every
-- other note, Rubric's included, is underlined as before.
local NEW_CODES = { ["new-part"] = true, drafting = true, ["draft-ready"] = true, ["draft-failed"] = true }
local underline = vim.diagnostic.handlers.underline
if underline and not underline.rubric then
  vim.diagnostic.handlers.underline = {
    rubric = true,
    show = function(namespace, bufnr, diagnostics, opts)
      local rest = vim.tbl_filter(function(d)
        return not (d.source == "rubric" and NEW_CODES[d.code])
      end, diagnostics)
      return underline.show(namespace, bufnr, rest, opts)
    end,
    hide = underline.hide,
  }
end

local function render(bufnr)
  if not vim.api.nvim_buf_is_loaded(bufnr) then
    return false
  end
  vim.api.nvim_buf_clear_namespace(bufnr, status_ns, 0, -1)
  local moving = false
  for _, d in ipairs(vim.diagnostic.get(bufnr)) do
    local mark, text, tone, spins
    if d.source == "rubric" then
      mark, text, tone, spins = looks(d)
    end
    if mark then
      moving = moving or spins == true
      local data = d.user_data.lsp.data
      local close = type(data.close) == "number" and data.close or d.lnum
      mark_block(bufnr, d.lnum, close, tone)
      pcall(vim.api.nvim_buf_set_extmark, bufnr, status_ns, d.lnum, 0, {
        virt_lines = under(bufnr, mark .. " " .. text, TONES[tone]),
        priority = 300,
      })
    end
  end
  local k = kept[bufnr]
  if k and vim.uv.now() < k.till then
    moving = true
    pcall(vim.api.nvim_buf_set_extmark, bufnr, status_ns, vim.api.nvim_buf_get_extmark_by_id(bufnr, kept_ns, k.mark, {})[1] or k.row, 0, {
      virt_lines = under(bufnr, "✓ " .. k.text, "DiagnosticOk"),
      priority = 300,
    })
  elseif k then
    kept[bufnr] = nil
  end
  return moving
end

-- Redraws every page; keeps a spinner turning while anything moves.
local function tick()
  frame = frame % #SPIN + 1
  local moving = false
  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(bufnr) and vim.b[bufnr].rubric_drafts then
      moving = render(bufnr) or moving
    end
  end
  if not moving and timer then
    timer:stop()
    timer:close()
    timer = nil
  end
end

local function wake()
  if not timer then
    timer = assert(vim.uv.new_timer())
    timer:start(0, 100, vim.schedule_wrap(tick))
  end
end

function mark_kept(bufnr, row, part, global)
  local settings = {}
  for _, s in ipairs(part.settings or {}) do
    table.insert(settings, #s.values > 0 and ("%s=%s"):format(s.name, table.concat(s.values, "|")) or (s.name .. "="))
  end
  local where = global and "for every theme" or "for this site"
  local text = ("%s kept %s%s"):format(part.name, where, #settings > 0 and (" · " .. table.concat(settings, " ")) or "")
  kept[bufnr] = { row = row, mark = vim.api.nvim_buf_set_extmark(bufnr, kept_ns, row, 0, {}), till = vim.uv.now() + 6000, text = text }
  vim.notify("rubric: " .. text, vim.log.levels.INFO)
  wake()
end

-- Follows a page's notes, so its lines show where their drafts are.
function M.watch(bufnr)
  vim.b[bufnr].rubric_drafts = true
  local function redraw()
    if render(bufnr) then
      wake()
    end
  end
  local group = vim.api.nvim_create_augroup("RubricDrafts" .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd("DiagnosticChanged", { group = group, buffer = bufnr, callback = redraw })
  -- The status is broken to the window's width; a resize breaks it again.
  vim.api.nvim_create_autocmd({ "WinResized", "VimResized", "BufWinEnter" }, {
    group = group,
    callback = function()
      if not vim.api.nvim_buf_is_loaded(bufnr) then
        return true
      end
      redraw()
    end,
  })
  render(bufnr)
end

-- A draft finished or failed: say so, wherever the writer is.
function M.drafted(_, state)
  if state.status == "drafting" then
    return
  end
  if state.status == "ready" then
    vim.notify(("rubric: %s drafted, in the preview · %s keep, reroll, cancel"):format(state.name, accept_key), vim.log.levels.INFO)
  elseif state.status == "failed" and state.message ~= "stopped" then
    vim.notify(("rubric: draft failed for “%s”: %s"):format(state.words, state.message or "no reason given"), vim.log.levels.WARN)
  end
end

return M
