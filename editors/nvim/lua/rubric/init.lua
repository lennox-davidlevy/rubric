-- Rubric for Neovim 0.12: the language server, ghost text and two keys.
--
--   vim.opt.runtimepath:append("/path/to/rubric/editors/nvim")
--   require("rubric").setup()
--
-- The server attaches only inside a Rubric site (a folder with rubric.md) and
-- only to Markdown. Ghost text is Neovim's own inline completion.

local M = {}

local defaults = {
  -- Accept the ghost text: pins the line.
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
  })
  vim.lsp.enable("rubric")

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
      local function map(lhs, rhs, desc)
        vim.keymap.set("i", lhs, rhs, { buffer = event.buf, desc = desc })
      end
      map(opts.accept, function()
        vim.lsp.inline_completion.get()
      end, "Rubric: accept and pin")
      map(opts.next, function()
        vim.lsp.inline_completion.select({ count = 1 })
      end, "Rubric: next pick")
      map(opts.prev, function()
        vim.lsp.inline_completion.select({ count = -1 })
      end, "Rubric: previous pick")
    end,
  })
end

return M
