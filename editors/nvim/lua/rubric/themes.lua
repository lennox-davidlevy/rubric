-- The theme list: rubric.md's `::: theme` line is chosen by looking. The
-- server sends every theme with its colors, type and picture, in order for the
-- words on the line; this draws them. With snacks.nvim it is a picker with the
-- names on the left and, on the right, a picture of the theme (where the
-- terminal can draw one), its colors and its type, and every page in the
-- browser takes on the theme under the cursor. Without snacks it is
-- vim.ui.select. Escape puts the theme back as it was.

local M = {}

local PIECES = { palette = true, pairing = true, scale = true }

-- Is this line rubric.md's theme line?
function M.is_theme_line(line)
  return line:match("^%s*:::+%s*theme$") ~= nil or line:match("^%s*:::+%s*theme%s") ~= nil
end

function M.is_rubric_md(bufnr)
  return vim.fs.basename(vim.api.nvim_buf_get_name(bufnr)) == "rubric.md"
end

-- The line as written: `::: theme paper palette=dracula`.
local function format(choice)
  local out = { "theme" }
  if choice.name then
    table.insert(out, choice.name)
  end
  for _, p in ipairs({ "palette", "pairing", "scale" }) do
    if choice[p] then
      table.insert(out, p .. "=" .. choice[p])
    end
  end
  return table.concat(out, " ")
end

-- Which list to open: the piece whose `key=` the cursor is on, or the themes.
-- A key typed without its "=" yet counts when it is last on the line, after
-- one word, the theme's name; among words (`large scale editorial`) it is a
-- word.
function M.piece_at(line, col)
  local from = line:match("^%s*:::+%s*theme()") or 1
  local words = 0
  for start, token, stop in line:sub(from):gmatch("()(%S+)()") do
    start, stop = start + from - 1, stop + from - 1
    local key, eq = token:match("^(%l+)(=?)")
    local bare = eq == "" and token == key and not line:find("%S", stop)
    if key and PIECES[key] and (eq == "=" or bare and words == 1) then
      if col + 1 >= start and col + 1 <= stop then
        return key
      end
    elseif not token:find("=") then
      words = words + 1
    end
  end
end
local piece_at = M.piece_at

-- The first theme line in the buffer, outside code fences; 0-based, or nil.
local function find_line(bufnr)
  local fence
  for i, l in ipairs(vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)) do
    local f = l:match("^%s*(```+)") or l:match("^%s*(~~~+)")
    if fence then
      if f and f:sub(1, 1) == fence:sub(1, 1) then
        fence = nil
      end
    elseif f then
      fence = f
    elseif M.is_theme_line(l) then
      return i - 1
    end
  end
end

-- The closers the plugin put below a line when "::: " was typed, marked so
-- they can be told from a block's own. A mark goes with its line.
local closer_ns = vim.api.nvim_create_namespace("rubric.closer")

function M.mark_closer(bufnr, row)
  vim.api.nvim_buf_set_extmark(bufnr, closer_ns, row, 0, { invalidate = true, undo_restore = false })
end

local function marked(bufnr, row)
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(bufnr, closer_ns, { row, 0 }, { row, -1 }, { details = true })) do
    if not m[4].invalid then
      return true
    end
  end
  return false
end

-- Takes away a closing ":::" below the line at `row` (0-based) that has no
-- block (the theme line, or a part that takes nothing inside), put there
-- when "::: " was typed. One the plugin put there is marked; at the top
-- level, a bare ":::" with no block open above it closes nothing, so it can
-- only be that one too. Inside a block, an unmarked one is the block's own.
function M.drop_closer(bufnr, row, opens_above)
  local below = vim.api.nvim_buf_get_lines(bufnr, row + 1, row + 2, false)[1]
  if below and below:match("^%s*:::+%s*$") and (marked(bufnr, row + 1) or opens_above(bufnr, row + 2) == 0) then
    pcall(vim.cmd.undojoin)
    vim.api.nvim_buf_set_lines(bufnr, row + 1, row + 2, false, {})
  end
end

-- Writes the choice on the line, without a closer below it.
local function write(bufnr, row, choice, opens_above)
  local line = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1] or ""
  local colons = line:match("^(%s*:::+)") or ":::"
  local text = colons .. " " .. format(choice)
  vim.api.nvim_buf_set_lines(bufnr, row, row + 1, false, { text })
  M.drop_closer(bufnr, row, opens_above)
  local win = vim.fn.bufwinid(bufnr)
  if win ~= -1 then
    vim.api.nvim_win_set_cursor(win, { row + 1, #text })
  end
end

-- ── Drawing one theme ───────────────────────────────────────────────────

local swatch_ns = vim.api.nvim_create_namespace("rubric.themes")
local made = {}

local function swatch_hl(hex)
  local name = "RubricSwatch" .. hex:gsub("#", "")
  if not made[name] then
    vim.api.nvim_set_hl(0, name, { bg = hex, fg = hex })
    made[name] = true
  end
  return name
end

local ORDER = { "paper", "ink", "accent", "muted", "rule", "tint", "band", "band-ink" }

-- Wraps `text` to `width` columns.
local function wrap(text, width)
  local out, line = {}, ""
  for word in text:gmatch("%S+") do
    if #line > 0 and #line + 1 + #word > width then
      table.insert(out, line)
      line = word
    else
      line = #line > 0 and (line .. " " .. word) or word
    end
  end
  if #line > 0 then
    table.insert(out, line)
  end
  return out
end

-- The lines under the picture, and where to color them.
local function describe(item, width)
  local lines, marks = {}, {}
  local function add(text, hl)
    table.insert(lines, text)
    if hl then
      table.insert(marks, { #lines - 1, 0, #text, hl })
    end
  end
  add(item.name .. (item.scheme and ("  · " .. item.scheme) or ""), "Title")
  add("")
  if item.colors then
    -- Two rows of blocks, each color's name under its block.
    local cell, cells, labels = 9, {}, ""
    for _, key in ipairs(ORDER) do
      local hex = item.colors[key]
      if hex and (#cells + 1) * cell <= width then
        table.insert(cells, { #cells * cell, #cells * cell + cell - 1, swatch_hl(hex) })
        labels = labels .. key .. string.rep(" ", cell - #key)
      end
    end
    local blocks = string.rep(" ", #cells * cell)
    for _ = 1, 2 do
      add(blocks)
      for _, c in ipairs(cells) do
        table.insert(marks, { #lines - 1, c[1], c[2], c[3] })
      end
    end
    add(labels, "Comment")
    add("")
  end
  local function field(label, value)
    if not value or value == "" then
      return
    end
    for i, l in ipairs(wrap(value, width - 8)) do
      add((i == 1 and string.format("%-7s ", label) or string.rep(" ", 8)) .. l)
      if i == 1 then
        table.insert(marks, { #lines - 1, 0, 7, "Comment" })
      end
    end
  end
  field("Type", item.type)
  field("Size", item.size)
  if item.palette then
    field("Pieces", ("%s, %s, %s"):format(item.palette, item.pairing, item.scale) .. (item.skin and (" · skin " .. item.skin) or ""))
  end
  add("")
  for _, l in ipairs(wrap(item.description or "", width)) do
    add(l)
  end
  return lines, marks
end

local function preview(ctx)
  local item = ctx.item
  local buf = ctx.preview:scratch()
  local win = ctx.preview.win.win
  local width = (win and vim.api.nvim_win_is_valid(win)) and vim.api.nvim_win_get_width(win) or 60
  local height = (win and vim.api.nvim_win_is_valid(win)) and vim.api.nvim_win_get_height(win) or 30
  local lines, marks = describe(item, width - 2)
  local picture = item.picture and Snacks.image and Snacks.image.supports(item.picture)
  -- The picture sits on the first line, an empty one, and below it.
  if picture then
    table.insert(lines, 1, "")
    for _, m in ipairs(marks) do
      m[1] = m[1] + 1
    end
  end
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  for _, m in ipairs(marks) do
    if m[4] then
      pcall(vim.api.nvim_buf_set_extmark, buf, swatch_ns, m[1], m[2], { end_col = m[3], hl_group = m[4] })
    end
  end
  ctx.preview:set_title(item.name)
  if picture then
    Snacks.image.placement.new(buf, item.picture, {
      inline = true,
      pos = { 1, 0 },
      max_width = width - 2,
      max_height = math.max(6, height - #lines - 1),
    })
  end
end

-- ── The list ────────────────────────────────────────────────────────────

-- Opens the list for the theme line at `row` (0-based) in rubric.md.
-- `opens_above(bufnr, row)` counts the blocks open above a line.
function M.open(bufnr, client, row, col, opens_above)
  local line = vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1] or ""
  local key = piece_at(line, col or 0)
  client:request("rubric/themes", { uri = vim.uri_from_bufnr(bufnr), line = row }, function(err, list)
    if err or not list then
      vim.notify("rubric: no theme list: " .. (err and err.message or "the server has none"), vim.log.levels.WARN)
      return
    end
    local current = list.current or {}
    local source = key and list[key] or list.themes
    local function choice_for(item)
      local c = vim.deepcopy(current)
      if key then
        c[key] = item.name
      else
        -- A new theme drops the swaps made for the old one.
        c = { name = item.name }
      end
      return c
    end
    local function show(item)
      client:notify("rubric/previewTheme", { theme = item and choice_for(item) or vim.NIL })
    end
    -- Chosen: the line says so, and the server stops showing the one looked
    -- at once the line names it. Closed: the theme goes back.
    local function done(item)
      if item then
        write(bufnr, row, choice_for(item), opens_above)
      else
        client:notify("rubric/previewTheme", { theme = vim.NIL })
      end
    end
    local title = key and ("Theme: " .. key) or "Themes"
    if list.ranked then
      title = title .. " · " .. list.ranked
    end
    if list.error then
      vim.notify("rubric: the list is in its own order: " .. list.error, vim.log.levels.WARN)
    end

    local ok, snacks = pcall(require, "snacks")
    if not ok or not snacks.picker then
      vim.ui.select(source, {
        prompt = title,
        format_item = function(item)
          return item.name .. "  " .. item.description
        end,
      }, done)
      return
    end
    local items = {}
    for i, item in ipairs(source) do
      local it = vim.deepcopy(item)
      it.idx = i
      it.text = item.name .. " " .. item.description
      table.insert(items, it)
    end
    local chosen
    snacks.picker.pick({
      title = title,
      items = items,
      format = function(item)
        return {
          { item.name, "SnacksPickerLabel" },
          { item.scheme == "dark" and "  dark" or "", "Comment" },
        }
      end,
      preview = preview,
      layout = { preset = "default" },
      on_change = function(_, item)
        if item then
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
  end)
end

-- `:Rubric theme`, or the accept key on the theme line: the list for the
-- line, written at the top of rubric.md first when there is none.
function M.command(bufnr, client, opens_above)
  if not M.is_rubric_md(bufnr) then
    vim.notify("rubric: the theme is chosen in rubric.md; open it and run :Rubric theme there", vim.log.levels.INFO)
    return
  end
  local row = find_line(bufnr)
  local col
  local cur = vim.api.nvim_win_get_cursor(0)
  if row and cur[1] - 1 == row then
    col = cur[2]
  end
  if not row then
    row = 0
    local first = vim.api.nvim_buf_get_lines(bufnr, 0, 1, false)[1]
    vim.api.nvim_buf_set_lines(bufnr, 0, 0, false, first and first ~= "" and { "::: theme", "" } or { "::: theme" })
  end
  M.open(bufnr, client, row, col, opens_above)
end

return M
