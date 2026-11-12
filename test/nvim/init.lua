-- Loaded by test/nvim.test.ts into a headless Neovim that the test drives
-- from outside over --listen, so keys arrive the way a writer's do. Sets up
-- the plugin with the stub resolver and gives the test a few probes.

vim.opt.runtimepath:append(vim.env.RUBRIC_REPO .. "/editors/nvim")
vim.cmd("filetype on")
require("rubric").setup({ args = vim.env.RUBRIC_LIVE and {} or { "--stub" } })

local function client()
  return vim.lsp.get_clients({ bufnr = 0, name = "rubric" })[1]
end

RubricTest = {}

function RubricTest.attached()
  return client() ~= nil
end

function RubricTest.codes()
  local codes = vim.tbl_map(function(d)
    return d.code
  end, vim.diagnostic.get(0))
  table.sort(codes)
  return table.concat(codes, ",")
end

-- Completion labels at a position, sorted.
function RubricTest.complete(line, character)
  local res = client():request_sync("textDocument/completion", {
    textDocument = { uri = vim.uri_from_bufnr(0) },
    position = { line = line, character = character },
  }, 5000, 0)
  local labels = vim.tbl_map(function(i)
    return i.label
  end, (res and res.result) or {})
  table.sort(labels)
  return table.concat(labels, ",")
end

-- The ghost text currently drawn, or "".
function RubricTest.ghost()
  local ns = vim.api.nvim_get_namespaces()["nvim.lsp.inline_completion"]
  if not ns then
    return ""
  end
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, { details = true })) do
    local vt = m[4].virt_text
    if vt and vt[1] then
      return vt[1][1]
    end
  end
  return ""
end

function RubricTest.line(n)
  return vim.api.nvim_buf_get_lines(0, n - 1, n, false)[1] or ""
end

-- The hint beside the ghost text when there is more than one pick, or "".
function RubricTest.picks()
  local ns = vim.api.nvim_get_namespaces()["rubric.picks"]
  if not ns then
    return ""
  end
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, { details = true })) do
    local vt = m[4].virt_text
    if vt and vt[1] then
      return vt[1][1]
    end
  end
  return ""
end

-- The hint on rubric.md's theme line, or "".
function RubricTest.theme_hint()
  local ns = vim.api.nvim_get_namespaces()["rubric.theme-hint"]
  if not ns then
    return ""
  end
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, { details = true })) do
    local vt = m[4].virt_text
    if vt and vt[1] then
      return vt[1][1]
    end
  end
  return ""
end

-- The words spell checking stops on with ]s, from the top, in order.
function RubricTest.misspelled()
  local view = vim.fn.winsaveview()
  local found = {}
  vim.api.nvim_win_set_cursor(0, { 1, 0 })
  vim.o.wrapscan = false
  while true do
    local before = vim.api.nvim_win_get_cursor(0)
    pcall(vim.cmd, "silent normal! ]s")
    local after = vim.api.nvim_win_get_cursor(0)
    if before[1] == after[1] and before[2] == after[2] then
      break
    end
    table.insert(found, vim.fn.expand("<cword>"))
  end
  vim.fn.winrestview(view)
  return table.concat(found, ",")
end

-- The theme list without snacks is vim.ui.select: this takes the first
-- choice offered, and remembers how many there were.
function RubricTest.take_first()
  vim.ui.select = function(items, _, on_choice)
    RubricTest.offered = #items
    on_choice(items[1])
  end
  return true
end

-- Answers for vim.ui.select and vim.ui.input, in order, so a test can choose
-- in the plugin's menus: an item is chosen by its value.
RubricTest.answers = {}
function RubricTest.answer(...)
  RubricTest.answers = { ... }
  return true
end
-- How many menus have opened.
RubricTest.menus = 0
vim.ui.select = function(items, _, on_choice)
  RubricTest.menus = RubricTest.menus + 1
  local want = table.remove(RubricTest.answers, 1)
  for _, item in ipairs(items) do
    if item.value == want then
      return on_choice(item)
    end
  end
  on_choice(nil)
end
vim.ui.input = function(_, on_confirm)
  on_confirm(table.remove(RubricTest.answers, 1))
end

-- The status under line n (1-based), its lines joined, or "".
function RubricTest.drafting(n)
  local ns = vim.api.nvim_get_namespaces()["rubric.drafting"]
  if not ns then
    return ""
  end
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, { n - 1, 0 }, { n - 1, -1 }, { details = true })) do
    local vl = m[4].virt_lines
    if vl and vl[1] then
      local parts = {}
      for _, l in ipairs(vl) do
        table.insert(parts, vim.trim(l[1][1]))
      end
      return table.concat(parts, " ")
    end
  end
  return ""
end

-- How many screen lines the status under line n takes, the widest, and
-- the room virtual lines have (the window less its number and sign columns).
function RubricTest.drafting_fit(n)
  local ns = vim.api.nvim_get_namespaces()["rubric.drafting"]
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, { n - 1, 0 }, { n - 1, -1 }, { details = true })) do
    local vl = m[4].virt_lines
    if vl then
      local widest = 0
      for _, l in ipairs(vl) do
        widest = math.max(widest, vim.fn.strdisplaywidth(l[1][1]))
      end
      local info = vim.fn.getwininfo(vim.api.nvim_get_current_win())[1]
      return ("%d %d %d"):format(#vl, widest, info.width - info.textoff)
    end
  end
  return ""
end

-- The mark that starts the status under line n (1-based): a spinner, ◆,
-- ✗, ↪, + or ✓; or "".
function RubricTest.draft_sign(n)
  return (RubricTest.drafting(n):match("^(%S+)")) or ""
end

-- The gutter beside line n (1-based): the `new:` block's bracket, or "".
function RubricTest.block(n)
  local ns = vim.api.nvim_get_namespaces()["rubric.drafting"]
  if not ns then
    return ""
  end
  for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, { n - 1, 0 }, { n - 1, -1 }, { details = true })) do
    if m[4].sign_text then
      return vim.trim(m[4].sign_text) .. " " .. (m[4].line_hl_group or "")
    end
  end
  return ""
end

-- The server's default drafter: its harness, model and effort, as a request
-- answers them.
function RubricTest.drafter()
  local res = client():request_sync("rubric/drafter", {}, 5000, 0)
  local r = res and res.result or {}
  local function v(x)
    return (x ~= nil and x ~= vim.NIL) and x or "default"
  end
  return (r.harness or "") .. " " .. v(r.model) .. " " .. v(r.effort)
end
