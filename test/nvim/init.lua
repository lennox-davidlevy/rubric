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
