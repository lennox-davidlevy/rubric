// The plugin and the server in a real, headless Neovim, driven from outside
// over --listen so keys arrive the way a writer's do, with the stub resolver.
// Skipped when nvim is not on the path.

import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The editor's language server can still be writing as it exits, and put
// back a folder just removed: remove it, wait, and remove it again.
async function gone(dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  await Bun.sleep(500);
  rmSync(dir, { recursive: true, force: true });
}

const repo = join(import.meta.dir, "..");
const nvim = Bun.which("nvim");

test.skipIf(!nvim)("Neovim: attach, diagnostics, completion, ghost text, accept, preview", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/slice"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
  const page = join(site, "pages/posts/smoke.md");
  writeFileSync(page, ["Intro.", "::: a big quote please", "Text.", ":::", "::: quote size=huge", ":::", "::: a spreadsheet of my taxes", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };

  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    expect(await until(() => expr("RubricTest.codes()") === "nothing-fits,value-not-allowed")).toBe(true);

    // Typing a new line: "::: " adds its closer below, and completion offers
    // the parts.
    keys("Go::: <Esc>");
    expect(await until(() => expr("RubricTest.line(9)") === ":::")).toBe(true);
    await Bun.sleep(400);
    expect(expr("RubricTest.complete(8, 4)")).toBe("callout,quote,section");
    keys("2dd");
    // A bare closer gets nothing added.
    keys("Go:::<Esc>");
    await Bun.sleep(200);
    expect(expr("RubricTest.line(10)")).toBe("");
    keys("dd");
    // Inside a block, the ":::" right below is the outer block's closer, so
    // the new one still gets its own.
    keys("Go::: outer<Esc>");
    expect(await until(() => expr("RubricTest.line(10)") === ":::")).toBe(true);
    keys(":call cursor(9, 1)<CR>o::: <Esc>");
    expect(await until(() => expr("RubricTest.line(12)") === ":::")).toBe(true);
    expect(expr("RubricTest.line(11)")).toBe(":::");
    keys(":9,12d<CR>");
    // At the top level, a free ":::" right below is used as the closer.
    keys("Go:::<Esc>O::: <Esc>");
    await Bun.sleep(200);
    expect(expr("RubricTest.line(10)")).toBe(":::");
    expect(expr("RubricTest.line(11)")).toBe("");
    keys(":9,10d<CR>");

    // Insert mode at the end of the words line: the ghost text appears, and
    // the plugin's accept key pins the line.
    keys(":call cursor(2, 1)<CR>A");
    // A writer stops typing; Neovim asks 200 ms later.
    await Bun.sleep(600);
    // (remote output is trimmed, so the ghost's leading space is not compared.)
    expect(await until(() => expr("RubricTest.ghost()") === "-> quote size=large")).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(2)") === "::: quote size=large")).toBe(true);
    keys("<Esc>");

    // The server reads the line as a plain form, and places it.
    const sidecar = join(site, ".rubric/sidecar/posts/smoke.md.json");
    expect(await until(() => {
      try {
        const [first] = JSON.parse(readFileSync(sidecar, "utf8"));
        return first.kind === "plain" && first.placed === true;
      } catch {
        return false;
      }
    })).toBe(true);
    expect(readFileSync(join(site, "content/posts/smoke.md"), "utf8").replace(/\{\{< rubric-line [^>]*>\}\}\n\n/g, "").split("\n")[1]).toBe(`{{< quote size="large" >}}`);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: accepting a pick on an empty block writes the part's starter body", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-body-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const page = join(site, "pages/posts/body.md");
  writeFileSync(page, ["---", "title: Body", "---", "::: steps please", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    keys(":call cursor(4, 1)<CR>A");
    await Bun.sleep(600);
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> steps"))).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(4)") === "::: steps")).toBe(true);
    keys("<Esc>");
    const lines = () => Array.from({ length: 9 }, (_, i) => expr(`RubricTest.line(${i + 4})`));
    expect(await until(() => lines()[8] === ":::")).toBe(true);
    expect(lines()).toEqual(["::: steps", "### The first step", "", "What to do.", "", "### The second step", "", "What to do next.", ":::"]);
    // The cursor stays at the end of the starter, and one undo brings the words back.
    expect(expr("vim.api.nvim_win_get_cursor(0)[1]")).toBe("11");
    keys("u");
    expect(await until(() => expr("RubricTest.line(4)") === "::: steps please" && expr("RubricTest.line(5)") === ":::")).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: accepting words after a pin's colon rewrites the pin and drops the words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-refine-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const page = join(site, "pages/posts/refine.md");
  writeFileSync(page, ["---", "title: Refine", "---", "::: video :", "https://youtu.be/x", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    keys(":call cursor(4, 1)<CR>A make it wide");
    await Bun.sleep(600);
    expect(await until(() => expr("RubricTest.ghost()").includes("width=wide"))).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(4)") === "::: video width=wide")).toBe(true);
    keys("<Esc>");
    expect(expr("RubricTest.line(5)")).toBe("https://youtu.be/x");
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: when Jev offers two picks, a hint beside the ghost text says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-picks-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const page = join(site, "pages/posts/picks.md");
  writeFileSync(page, ["---", "title: Picks", "---", "::: a sidenote or a callout", "Hi.", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    keys(":call cursor(4, 1)<CR>A");
    await Bun.sleep(600);
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> sidenote"))).toBe(true);
    // The remote call trims the hint's leading spaces.
    expect(await until(() => expr("RubricTest.picks()") === "1 of 2 · <M-n> for the next")).toBe(true);
    keys("<M-n>");
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> callout"))).toBe(true);
    expect(expr("RubricTest.picks()")).toBe("");
    // The preview shows the pick the ghost text is on, in both directions,
    // and goes back to what the line resolved to when insert mode ends.
    const written = () => readFileSync(join(site, "content/posts/picks.md"), "utf8");
    expect(await until(() => written().includes("{{< callout >}}"))).toBe(true);
    keys("<M-p>");
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> sidenote"))).toBe(true);
    expect(await until(() => written().includes("{{< sidenote >}}") && !written().includes("{{< callout >}}"))).toBe(true);
    keys("<M-n>");
    expect(await until(() => written().includes("{{< callout >}}"))).toBe(true);
    keys("<Esc>");
    expect(await until(() => !written().includes("{{< callout >}}") && written().includes("::: a sidenote or a callout"))).toBe(true);
    keys("A");
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> sidenote"))).toBe(true);
    keys("<M-n>");
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> callout"))).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(4)") === "::: callout")).toBe(true);
    expect(await until(() => written().includes("{{< callout >}}"))).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: switching the theme in hugo.toml reaches the server without a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-theme-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  // No real skin adds a part now, so a small one stands in, with a theme using it.
  const themes = join(dir, "themes");
  mkdirSync(join(themes, "universal/skins"), { recursive: true });
  cpSync(join(repo, "catalogs/universal/catalog.yaml"), join(themes, "universal/catalog.yaml"));
  writeFileSync(join(themes, "universal/skins/sashes.yaml"), "name: sashes\nversion: 1\nparts:\n  sash:\n    description: A strip across the corner of the page.\n    children: true\n    body: |\n      A word or two.\n");
  writeFileSync(join(themes, "universal/themes.yaml"), "paper: {}\nsashy: { skin: sashes }\n");
  const config = readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(themes)}`)
    .replace(/^theme = .*$/m, `theme = "universal"`);
  writeFileSync(join(site, "hugo.toml"), config);
  const page = join(site, "pages/posts/theme.md");
  writeFileSync(page, ["---", "title: Theme", "---", "::: sash", "Hi.", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  try {
    expect(await until(() => expr("RubricTest.codes()") === "other-skin")).toBe(true);
    writeFileSync(join(site, "hugo.toml"), config.replace(/^theme = "paper"$/m, `theme = "sashy"`));
    expect(await until(() => expr("RubricTest.codes()") === "")).toBe(true);
  } finally {
    remote("--remote-send", "<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: the accept key on rubric.md's theme line opens the theme list, in order for its words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-themes-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const rubric = join(site, "rubric.md");
  // The closer below is the one "::: " puts there; a theme line has none.
  writeFileSync(rubric, ["::: theme solarized cream", ":::", "", "::: header", "- [Posts](/posts/)", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", rubric], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  const frameTheme = () => {
    try {
      return JSON.stringify(JSON.parse(readFileSync(join(site, "content/rubric-frame/index.md"), "utf8")).theme ?? null);
    } catch {
      return "";
    }
  };
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    expect(await until(() => expr("RubricTest.codes()") === "stray-closer,theme-unpicked")).toBe(true);
    expect(expr("RubricTest.take_first()")).toBe("true");
    // The stub puts the theme sharing the most words first.
    keys(":call cursor(1, 1)<CR>A<M-l>");
    expect(await until(() => expr("RubricTest.line(1)") === "::: theme solarized-light")).toBe(true);
    expect(expr("RubricTest.line(2)")).toBe("");
    expect(Number(expr("RubricTest.offered"))).toBeGreaterThan(60);
    expect(await until(() => frameTheme() === `{"name":"solarized-light"}`)).toBe(true);
    expect(await until(() => expr("RubricTest.codes()") === "")).toBe(true);

    // On a piece's key=, the accept key in normal mode opens that piece's
    // list, and the hint on the line names it.
    keys(`:call setline(1, "::: theme paper palette=dracula")<CR>:call cursor(1, 18)<CR>`);
    expect(await until(() => expr("RubricTest.theme_hint()").includes("palette"))).toBe(true);
    keys("<M-l>");
    const first = (dir: string) => readdirSync(join(repo, "catalogs/universal/themes", dir)).filter((f) => f.endsWith(".yaml")).sort()[0]!.slice(0, -5);
    expect(await until(() => expr("RubricTest.line(1)") === `::: theme paper palette=${first("palettes")}`)).toBe(true);
    expect(await until(() => frameTheme() === `{"name":"paper","palette":"${first("palettes")}"}`)).toBe(true);
    // Off the line, no hint; on its theme name, the hint is the theme list's.
    keys(":call cursor(4, 1)<CR>");
    expect(await until(() => expr("RubricTest.theme_hint()") === "")).toBe(true);
    keys(":call cursor(1, 12)<CR>");
    expect(await until(() => expr("RubricTest.theme_hint()").includes("theme"))).toBe(true);
    // A key typed without its "=" yet opens its list too, here by :Rubric theme.
    keys(`:call setline(1, "::: theme paper scale")<CR>:call cursor(1, 18)<CR>:Rubric theme<CR>`);
    expect(await until(() => expr("RubricTest.line(1)") === `::: theme paper scale=${first("scales")}`)).toBe(true);

    // Typed by hand: the closer "::: " put below goes once the line is a theme
    // line, and the block below keeps its own.
    keys(":1,2d<CR>ggO::: <Esc>");
    expect(await until(() => expr("RubricTest.line(2)") === ":::")).toBe(true);
    keys("Atheme paper");
    expect(await until(() => expr("RubricTest.line(2)") === "::: header")).toBe(true);
    keys("<Esc>");
    // A bare "::: theme" could still become a part like theme-switch, so its
    // closer waits for insert mode to end.
    keys(":1d<CR>ggO::: <Esc>Atheme");
    await Bun.sleep(300);
    expect(expr("RubricTest.line(2)")).toBe(":::");
    keys("<Esc>");
    expect(await until(() => expr("RubricTest.line(2)") === "::: header")).toBe(true);
    // The header's own closer stays.
    expect(expr("RubricTest.line(4)")).toBe(":::");

    // A closer already there goes with the first edit to the line, and one
    // undo brings both back, with nothing taking it away again.
    keys(`:call setline(1, "::: theme paper")<CR>:call append(1, ":::")<CR>`);
    expect(await until(() => expr("RubricTest.line(2)") === ":::")).toBe(true);
    keys(":call cursor(1, 11)<CR>cwbear<Esc>");
    expect(await until(() => expr("RubricTest.line(2)") === "::: header")).toBe(true);
    keys("u");
    expect(await until(() => expr("RubricTest.line(1)") === "::: theme paper")).toBe(true);
    await Bun.sleep(300);
    expect(expr("RubricTest.line(2)")).toBe(":::");
    // Among words, a piece's name is a word: the list is the themes'.
    keys(`:call setline(1, "::: theme large scale editorial")<CR>:call cursor(1, 18)<CR>`);
    expect(await until(() => expr("RubricTest.theme_hint()").includes("theme list"))).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: a part that takes nothing inside loses the closer typing \"::: \" put below it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-alone-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const page = join(site, "pages/posts/alone.md");
  writeFileSync(page, ["---", "title: Alone", "---", "Intro.", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  const all = () => expr("table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '|')");
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);

    // Typed by hand: the closer goes when insert mode ends.
    keys("Go::: <Esc>");
    expect(await until(() => expr("RubricTest.line(6)") === ":::")).toBe(true);
    keys("Adivider style=ornament<Esc>");
    expect(await until(() => all() === "---|title: Alone|---|Intro.|::: divider style=ornament")).toBe(true);

    // Or when Enter leaves the line, with the writing going on below it.
    keys("o::: <Esc>");
    expect(await until(() => expr("RubricTest.line(7)") === ":::")).toBe(true);
    // (Sent apart, as typed: Neovim checks the cursor when no keys are waiting.)
    keys("Acontents<CR>");
    await Bun.sleep(200);
    keys("Then more.<Esc>");
    expect(await until(() => all() === "---|title: Alone|---|Intro.|::: divider style=ornament|::: contents|Then more.")).toBe(true);

    // Words that start with such a part's name are words, and keep theirs.
    keys("o::: <Esc>Asearch for something<Esc>");
    await Bun.sleep(300);
    expect(expr("RubricTest.line(9)")).toBe(":::");
    keys(":8,9d<CR>");

    // Accepting words that pick one takes the empty block's closer too.
    keys("Go::: <Esc>");
    expect(await until(() => expr("RubricTest.line(9)") === ":::")).toBe(true);
    keys("Aa divider please");
    await Bun.sleep(600);
    expect(await until(() => expr("RubricTest.ghost()") === "-> divider")).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(8)") === "::: divider")).toBe(true);
    keys("<Esc>");
    expect(await until(() => expr("RubricTest.line(9)") === "")).toBe(true);
    // One undo brings the words and the closer back.
    keys("u");
    expect(await until(() => expr("RubricTest.line(9)") === ":::")).toBe(true);
    expect(expr("RubricTest.codes()")).not.toContain("stray-closer");

    // Inside a block: the closer the plugin put there goes, and the block's
    // own stays.
    keys(":8,$d<CR>Go::: <Esc>");
    expect(await until(() => expr("RubricTest.line(9)") === ":::")).toBe(true);
    keys("Asection<Esc>oInside.<Esc>o::: <Esc>");
    expect(await until(() => all().endsWith("|::: section|Inside.|::: |:::|:::"))).toBe(true);
    keys("Adivider<Esc>");
    expect(await until(() => all().endsWith("|Then more.|::: section|Inside.|::: divider|:::"))).toBe(true);
    expect(await until(() => !expr("RubricTest.codes()").includes("stray-closer"))).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: the accept key before any ghost text asks at once, without waiting for the pause", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-now-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/blog"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8")
    .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`)
    .replace(/^theme = .*$/m, `theme = "universal"`));
  const page = join(site, "pages/posts/now.md");
  writeFileSync(page, ["---", "title: Now", "---", "::: a", "Hi.", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(20)) if (f()) return true;
    return false;
  };
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    keys(":call cursor(4, 1)<CR>A big quote please");
    expect(await until(() => expr("RubricTest.line(4)") === "::: a big quote please")).toBe(true);
    // The server waits a second for a pause; the accept key doesn't.
    const started = Date.now();
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.ghost()").startsWith("-> quote"), 900)).toBe(true);
    expect(Date.now() - started).toBeLessThan(900);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(4)").startsWith("::: quote"))).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: typing on after the ghost text shows takes it away, and the next answer lands at the new end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-typing-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/slice"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
  const page = join(site, "pages/posts/typing.md");
  writeFileSync(page, ["Intro.", "::: a big quote", "Text.", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  const whole = "-> quote size=large";

  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    keys(":call cursor(2, 1)<CR>A");
    expect(await until(() => expr("RubricTest.ghost()") === whole)).toBe(true);

    // Typing on: the ghost never loses its first letters to what was typed.
    keys(" please");
    const seen = expr("RubricTest.ghost()");
    expect(seen === "" || seen === whole).toBe(true);
    expect(expr("RubricTest.line(2)")).toBe("::: a big quote please");

    // One more letter and a pause: the line is asked again, and accepting
    // puts the pin after the words, not where the line used to end.
    expect(await until(() => expr("RubricTest.ghost()") === whole)).toBe(true);
    keys("s");
    expect(await until(() => expr("RubricTest.ghost()") !== whole, 1000)).toBe(true);
    expect(await until(() => expr("RubricTest.ghost()") === whole)).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(2)") === "::: quote size=large")).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: spell checking skips part names and settings, and keeps the writer's words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-spell-"));
  const sock = join(dir, "nvim.sock");
  cpSync(join(repo, "sites/slice"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
  const page = join(site, "pages/posts/spell.md");
  writeFileSync(page, [
    "The wrods stay checked.",
    "::: a big qoute",
    ":::",
    "::: callout icon=lightbulb : make it biggr",
    ":::",
    "::: callout icon=lightbulb cite=\"Ch. 2: Hme\"",
    ":::",
    "::: callout icon=",
    ":::",
    "::: the first and secnd thing",
    ":::",
    "",
  ].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", "--cmd", "set spell spelllang=en", page], {
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };

  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);
    expect(await until(() => expr("RubricTest.misspelled()") === "wrods,qoute,biggr,secnd")).toBe(true);

    // A line typed now is marked as it changes, and words stay words.
    keys("Go::: callout icon=lightbulbb<Esc>");
    expect(await until(() => expr("RubricTest.line(12)") === "::: callout icon=lightbulbb")).toBe(true);
    expect(expr("RubricTest.misspelled()")).toBe("wrods,qoute,biggr,secnd");
    keys("cc::: a wooden lightbulbb<Esc>");
    expect(await until(() => expr("RubricTest.misspelled()") === "wrods,qoute,biggr,secnd,lightbulbb")).toBe(true);
    // A theme line is all names: the theme's and its pieces'.
    keys("cc::: theme hyde-red palette=dracula pairing=pt-abril-hyde<Esc>");
    expect(await until(() => expr("RubricTest.misspelled()") === "wrods,qoute,biggr,secnd")).toBe(true);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);

test.skipIf(!nvim)("Neovim: words nothing fits become a new part, drafted, then kept or cancelled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rubric-nvim-new-"));
  const sock = join(dir, "nvim.sock");
  // The testing site, whose hugo.toml mounts .rubric/hugo/ for drafts.
  cpSync(join(repo, "testing"), join(dir, "site"), { recursive: true, filter: (src) => !/\/(content|\.rubric|public|resources)(\/|$)/.test(src) });
  const site = join(dir, "site");
  writeFileSync(join(site, "hugo.toml"), readFileSync(join(site, "hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(repo, "catalogs"))}`));
  const page = join(site, "pages/posts/new.md");
  writeFileSync(page, ["---", "title: New", "---", "::: a wobbly orbit of moons", ":::", "", "::: new: slow comet tails", ":::", "", "::: new: a quote or a callout", "Words.", ":::", ""].join("\n"));

  const editor = Bun.spawn([nvim!, "--headless", "--listen", sock, "-u", join(repo, "test/nvim/init.lua"), "-i", "NONE", page], {
    // A data folder of its own, where :Rubric harness keeps its choice.
    cwd: site, env: { ...process.env, RUBRIC_REPO: repo, XDG_DATA_HOME: join(dir, "data") }, stdout: "ignore", stderr: "ignore",
  });
  const remote = (flag: string, arg: string) => Bun.spawnSync([nvim!, "--server", sock, flag, arg]).stdout.toString().trim();
  const expr = (lua: string) => remote("--remote-expr", `luaeval("${lua.replace(/"/g, '\\"')}")`);
  const keys = (k: string) => remote("--remote-send", k);
  const until = async (f: () => boolean, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (f()) return true;
    return false;
  };
  // The note on a line, by code.
  const note = (line: number) => expr(`(function() for _, d in ipairs(vim.diagnostic.get(0, { lnum = ${line - 1} })) do return d.code end return '' end)()`);
  try {
    expect(await until(() => expr("RubricTest.attached()") === "true")).toBe(true);

    // Parts near a `new:` line's words are offered before drafting: looked
    // at in a list, the one chosen takes the line, and nothing is drafted.
    expect(await until(() => note(10) === "new-part")).toBe(true);
    // Jev is asked as the menu opens, which waits for the answer.
    expr("RubricTest.answer('look', 'callout')");
    keys(":call cursor(10, 1)<CR><M-l>");
    expect(await until(() => expr("RubricTest.line(10)") === "::: callout")).toBe(true);
    expect(expr("RubricTest.line(11)")).toBe("Words.");
    expect(existsSync(join(site, ".rubric/drafts")) ? readdirSync(join(site, ".rubric/drafts")) : []).toEqual([]);

    // Nothing fits: the ghost text offers a new part, and accepting it turns
    // the line into a `new:` line and asks how to draft it: as set up.
    keys(":call cursor(4, 1)<CR>A");
    await Bun.sleep(600);
    expect(await until(() => expr("RubricTest.ghost()").startsWith("->"))).toBe(true);
    expr("RubricTest.answer('draft')");
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(4)") === "::: new: a wobbly orbit of moons")).toBe(true);
    keys("<Esc>");
    expect(await until(() => note(4) === "draft-ready")).toBe(true);
    // The line under it shows it's ready.
    expect(await until(() => expr("RubricTest.draft_sign(4)") === "◆")).toBe(true);
    // From insert mode, at the end of the line, the accept key leaves insert
    // mode and opens the menu at once.
    const menus = Number(expr("RubricTest.menus"));
    keys(":call cursor(4, 1)<CR>A<M-l>");
    expect(await until(() => Number(expr("RubricTest.menus")) === menus + 1)).toBe(true);
    expect(expr("vim.api.nvim_get_mode().mode")).toBe("n");
    // The block reads apart from the page: a bracket from its line to its
    // closer, in the color of where the draft is.
    expect(expr("RubricTest.block(4)")).toBe("╭ RubricNewBlockOk");
    expect(expr("RubricTest.block(5)")).toBe("╰ RubricNewBlockOk");
    expect(expr("RubricTest.block(6)")).toBe("");
    // No squiggle under the request: nothing on the line is underlined.
    const underlined = expr(`(function() local n = 0 for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, -1, { 3, 0 }, { 3, -1 }, { details = true })) do local g = m[4].hl_group if type(g) == 'string' and g:find('Underline') then n = n + 1 end end return n end)()`);
    expect(underlined).toBe("0");
    // A reroll adds a take; the keys that move between picks move between them.
    const data = (key: string) => expr(`(function() for _, d in ipairs(vim.diagnostic.get(0, { lnum = 3 })) do local v = d.user_data and d.user_data.lsp and d.user_data.lsp.data; return v and tostring(v.${key}) or '' end return '' end)()`);
    // One Reroll, which asks whether to change anything first: no.
    expr("RubricTest.answer('reroll', 'just')");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => data("takes") === "2" && note(4) === "draft-ready")).toBe(true);
    expect(data("take")).toBe("2");
    keys("<M-p>");
    expect(await until(() => data("take") === "1")).toBe(true);
    keys("<M-n>");
    expect(await until(() => data("take") === "2")).toBe(true);
    // The menu lists the takes; choosing one puts it on screen and comes
    // back to the menu, and Esc in the list leaves the take as it was.
    let opened = Number(expr("RubricTest.menus"));
    expr("RubricTest.answer('takes', 1)");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => data("take") === "1")).toBe(true);
    expect(await until(() => Number(expr("RubricTest.menus")) === opened + 3)).toBe(true);
    opened = Number(expr("RubricTest.menus"));
    expr("RubricTest.answer('takes', 'none of them')");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => Number(expr("RubricTest.menus")) === opened + 3)).toBe(true);
    expect(data("take")).toBe("1");
    keys("<M-n>");
    expect(await until(() => data("take") === "2")).toBe(true);
    // Yes: notes on what to change, and another drafter for this one alone,
    // which joins the ones used lately; the default stays as it was.
    const saved = join(dir, "data/nvim/rubric/draft.json");
    const mode = () => expr("vim.lsp.get_clients({ name = 'rubric' })[1]:request_sync('rubric/drafting', {}, 2000).result.mode");
    // Esc in the drafter's lists goes back to the changes, and remembers
    // nothing. With notes set, the changes' own list starts the reroll.
    expr("RubricTest.answer('reroll', 'change', 'drafter', 'nothing-here', 'notes', 'smaller moons', 'start')");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => data("takes") === "3" && note(4) === "draft-ready")).toBe(true);
    // The notes reached the take the reroll made.
    expect(readdirSync(join(site, ".rubric/drafts")).some((d) => { try { return readFileSync(join(site, ".rubric/drafts", d, "part.html"), "utf8").includes("smaller moons"); } catch { return false; } })).toBe(true);
    expect(existsSync(saved)).toBe(false);
    const takeBy = () => readdirSync(join(site, ".rubric/drafts")).map((d) => { try { return JSON.parse(readFileSync(join(site, ".rubric/drafts", d, "state.json"), "utf8")) as { by?: string; started: number }; } catch { return undefined; } }).filter((x) => x !== undefined).sort((a, b) => b.started - a.started)[0]?.by;
    if (Bun.which("claude")) {
      expr("RubricTest.answer('reroll', 'change', 'drafter', 'other', 'claude', 'opus', 'high', 'back', 'just')");
      keys(":call cursor(4, 1)<CR><M-l>");
      expect(await until(() => data("takes") === "4" && note(4) === "draft-ready")).toBe(true);
      // It reached the server for this take alone, and is among the recent ones.
      expect(takeBy()).toContain("claude with opus at high effort");
      expect(JSON.parse(readFileSync(saved, "utf8")).recent?.[0]).toEqual({ harness: "claude", model: "opus", effort: "high" });
      expect(JSON.parse(readFileSync(saved, "utf8")).default).toBeUndefined();
    }
    expect(expr("RubricTest.drafter()")).toBe("claude opus low");
    // A drafter the tool doesn't have is refused before anything starts.
    const refused = expr(`(function() local c = vim.lsp.get_clients({ name = 'rubric' })[1] local r = c:request_sync('rubric/draft', { uri = vim.uri_from_bufnr(0), line = 3, action = 'reroll', change = '', drafter = { harness = 'claude', model = 'no-such-model' } }, 5000, 0) return r and r.result and r.result.error or '' end)()`);
    expect(refused).toContain("no-such-model");
    // The status sits under the line and wraps to the window, so none of it
    // is cut off, even in a narrow one.
    keys(":vsplit<CR>:vertical resize 40<CR>");
    expect(await until(() => {
      const [lines, widest, width] = expr("RubricTest.drafting_fit(4)").split(" ").map(Number);
      return lines! > 1 && widest! <= width!;
    })).toBe(true);
    expect(expr("RubricTest.drafting(4)")).toContain("<M-l>");
    keys(":only<CR>");

    // :Rubric log opens the draft's log below, read only, and the cursor stays in the page.
    const before = Number(expr("vim.fn.winnr('$')"));
    keys(":call cursor(4, 1)<CR>:Rubric log<CR>");
    expect(await until(() => Number(expr("vim.fn.winnr('$')")) === before + 1)).toBe(true);
    expect(expr("vim.fn.bufname(vim.fn.winbufnr(vim.fn.winnr('$')))")).toMatch(/\.rubric\/drafts\/.+\/draft\.log$/);
    expect(expr("vim.bo[vim.fn.winbufnr(vim.fn.winnr('$'))].modifiable")).toBe("false");
    expect(Number(expr("vim.api.nvim_buf_line_count(vim.fn.winbufnr(vim.fn.winnr('$')))"))).toBeGreaterThan(1);
    expect(expr("RubricTest.line(4)")).toBe("::: new: a wobbly orbit of moons");
    keys(":only<CR>");

    // The accept key asks what to do with it: keep, for this site only.
    expr("RubricTest.answer('keep', false)");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => expr("RubricTest.line(4)") === "::: wobbly-orbit")).toBe(true);
    expect(await until(() => readdirSync(join(site, "parts")).includes("wobbly-orbit"))).toBe(true);
    expect(await until(() => note(4) === "")).toBe(true);
    // Kept: a check for a while, saying what settings the part takes.
    expect(expr("RubricTest.draft_sign(4)")).toBe("✓");
    // The kept part's block is empty: its starter shows inside it, dimmed,
    // and the accept key on the closer fills it in.
    const starter = () => expr(`(function() local ns = vim.api.nvim_get_namespaces()['rubric.starters'] if not ns then return '' end for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, { details = true })) do local vl = m[4].virt_lines if vl then return m[2] .. ':' .. vim.trim(vl[1][1][1]) end end return '' end)()`);
    expect(await until(() => /^4:\S/.test(starter()))).toBe(true);
    const first = starter().slice(2);
    keys(":call cursor(5, 1)<CR><M-l>");
    expect(await until(() => expr("RubricTest.line(5)") === first)).toBe(true);
    expect(await until(() => starter() === "")).toBe(true);
    expect(expr("RubricTest.line(4)")).toBe("::: wobbly-orbit");
    // Undone, the block is empty again, and the page as the rest expects it.
    keys(":undo<CR>");
    expect(await until(() => expr("RubricTest.line(5)") === ":::")).toBe(true);
    expect(await until(() => /^4:\S/.test(starter()))).toBe(true);
    // On the part's own line, a part of the site's own, the accept key opens
    // its menu, which fills in the starter too; a quiet hint says so.
    const hint = () => expr(`(function() local ns = vim.api.nvim_get_namespaces()['rubric.own'] if not ns then return '' end for _, m in ipairs(vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, { details = true })) do local vt = m[4].virt_text if vt then return m[2] .. ':' .. vt[1][1] end end return '' end)()`);
    keys(":call cursor(4, 1)<CR>");
    expect(await until(() => hint().startsWith("3:") && hint().includes("<M-l>"))).toBe(true);
    keys(":call cursor(6, 1)<CR>");
    expect(await until(() => hint() === "")).toBe(true);
    expr("RubricTest.answer('fill')");
    keys(":call cursor(4, 1)<CR>$<M-l>");
    expect(await until(() => expr("RubricTest.line(5)") === first)).toBe(true);
    keys(":undo<CR>");
    expect(await until(() => expr("RubricTest.line(5)") === ":::")).toBe(true);

    // Another take of it keeps its name, so the line stays; the keys that
    // move between picks move between its takes, the first the kept one.
    expr("RubricTest.answer('reroll', 'just')");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => note(4) === "draft-ready" && data("takes") === "2")).toBe(true);
    expect(expr("RubricTest.line(4)")).toBe("::: wobbly-orbit");
    expect(await until(() => expr("RubricTest.draft_sign(4)") === "◆")).toBe(true);
    keys("<M-p>");
    expect(await until(() => data("take") === "1")).toBe(true);
    keys("<M-n>");
    expect(await until(() => data("take") === "2")).toBe(true);
    // Words after ":" are the change asked for: they leave the line as it starts.
    keys(":call setline(4, '::: wobbly-orbit : brighter')<CR>");
    expr("RubricTest.answer('reroll', 'just')");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => expr("RubricTest.line(4)") === "::: wobbly-orbit")).toBe(true);
    expect(await until(() => note(4) === "draft-ready" && data("takes") === "3")).toBe(true);
    // Back to it as it was: its takes go, the line stays.
    expr("RubricTest.answer('cancel')");
    keys(":call cursor(4, 1)<CR><M-l>");
    expect(await until(() => note(4) === "")).toBe(true);
    expect(await until(() => readdirSync(join(site, ".rubric/drafts")).every((d) => !d.startsWith("wobbly-orbit")))).toBe(true);
    expect(expr("RubricTest.line(4)")).toBe("::: wobbly-orbit");

    // A `new:` typed by hand is drafted only on the accept key; cancel puts
    // the words back.
    expect(note(7)).toBe("new-part");
    expr("RubricTest.answer('draft')");
    keys(":call cursor(7, 1)<CR><M-l>");
    // While it's drafted, a spinner turns and the line counts the time.
    expect(await until(() => /\d:\d\d/.test(expr("RubricTest.drafting(7)")) && !["", "◆", "+", "✓"].includes(expr("RubricTest.draft_sign(7)")))).toBe(true);
    // Taking too long: stop it. The line stays a `new:` line, with nothing drafted.
    expr("RubricTest.answer('stop')");
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.draft_sign(7)") === "+")).toBe(true);
    expect(expr("RubricTest.line(7)")).toBe("::: new: slow comet tails");
    expr("RubricTest.answer('draft')");
    keys("<M-l>");
    expect(await until(() => note(7) === "draft-ready")).toBe(true);
    expect(await until(() => expr("RubricTest.draft_sign(7)") === "◆")).toBe(true);
    expr("RubricTest.answer('cancel')");
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(7)") === "::: slow comet tails")).toBe(true);
    expect(readdirSync(join(site, ".rubric/drafts"))).toEqual([]);

    // Cancel, from the first menu, puts the words back too.
    keys(":call setline(7, '::: new: quiet comet trails')<CR>");
    expect(await until(() => note(7) === "new-part")).toBe(true);
    expr("RubricTest.answer('cancel')");
    keys(":call cursor(7, 1)<CR><M-l>");
    expect(await until(() => expr("RubricTest.line(7)") === "::: quiet comet trails")).toBe(true);

    // The default drafter: :Rubric model chooses its model, then how hard
    // it thinks; kept, whole, for the next session.
    const atStart = (setup: string) => expr(`(function() local d = require('rubric.drafts').drafter({ harness = 'claude' }, ${setup}) return d.harness .. ' ' .. (d.model or 'default') .. ' ' .. (d.effort or 'default') end)()`);
    expr("RubricTest.answer('haiku', 'medium')");
    keys(":Rubric model<CR>");
    expect(await until(() => expr("RubricTest.drafter()") === "claude haiku medium")).toBe(true);
    expect(JSON.parse(readFileSync(saved, "utf8")).default).toEqual({ harness: "claude", model: "haiku", effort: "medium" });
    // A server that starts with another drafter, as after a restart, is
    // told the kept one when it attaches.
    expr(`vim.lsp.get_clients({ name = 'rubric' })[1]:request_sync('rubric/setDrafter', { harness = 'claude', model = 'opus', effort = 'high' }, 5000, 0)`);
    expect(expr("RubricTest.drafter()")).toBe("claude opus high");
    expr(`require('rubric.drafts').sync(vim.lsp.get_clients({ name = 'rubric' })[1], 0, nil, { harness = 'claude', model = 'opus', effort = 'low' }, { harness = 'claude' }, nil)`);
    expect(await until(() => expr("RubricTest.drafter()") === "claude haiku medium")).toBe(true);
    // The tool's own defaults: no model or effort, and the setup's don't
    // come back at the next start.
    expr("RubricTest.answer('default', 'default')");
    keys(":Rubric model<CR>");
    expect(await until(() => expr("RubricTest.drafter()") === "claude default default")).toBe(true);
    expect(await until(() => JSON.parse(readFileSync(saved, "utf8")).default?.model === undefined)).toBe(true);
    expect(atStart("{ harness = 'claude', model = 'opus' }")).toBe("claude default default");
    // :Rubric harness: the tool (it has to be installed), its model and
    // effort; or back to the setup's choice, forgetting this one.
    if (Bun.which("claude")) {
      // Last, whether it drafts with tools, which the server takes too.
      expr("RubricTest.answer('claude', 'opus', 'high', 'tools')");
      keys(":Rubric harness<CR>");
      expect(await until(() => expr("RubricTest.drafter()") === "claude opus high")).toBe(true);
      expect(await until(() => mode() === "tools")).toBe(true);
      expect(JSON.parse(readFileSync(saved, "utf8")).drafting).toBe("tools");
      expr("RubricTest.answer('fast')");
      keys(":Rubric tooluse<CR>");
      expect(await until(() => mode() === "fast")).toBe(true);
    }
    expr("RubricTest.answer('setup')");
    keys(":Rubric harness<CR>");
    expect(await until(() => expr("RubricTest.drafter()") === "claude opus low")).toBe(true);
    expect(await until(() => existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")).default === undefined : true)).toBe(true);
    // :Rubric tooluse chooses drafts with tools or without; the server
    // takes it, and the choice is kept for the next start.
    expect(expr("require('rubric.drafts').drafting(nil)")).toBe("fast");
    expr("RubricTest.answer('tools')");
    keys(":Rubric tooluse<CR>");
    expect(await until(() => existsSync(saved) && JSON.parse(readFileSync(saved, "utf8")).drafting === "tools")).toBe(true);
    expect(expr("require('rubric.drafts').drafting('fast')")).toBe("tools");
    expect(await until(() => mode() === "tools")).toBe(true);
    // The drafter is named with it for as long as tools are on.
    const named = () => expr("vim.lsp.get_clients({ name = 'rubric' })[1]:request_sync('rubric/drafter', {}, 2000).result.short");
    expect(named().endsWith(", tools")).toBe(true);
    expr("RubricTest.answer('fast')");
    keys(":Rubric tooluse<CR>");
    expect(await until(() => JSON.parse(readFileSync(saved, "utf8")).drafting === "fast")).toBe(true);
    expect(await until(() => !named().includes("tools"))).toBe(true);
    // A setup that leaves the tool out means Claude Code, and the server
    // starts with it named.
    expect(atStart("{ model = 'haiku' }")).toBe("claude haiku default");
    expect(expr(`table.concat(require('rubric.drafts').args(require('rubric.drafts').from_setup({ model = 'haiku' })), ' ')`)).toBe("--harness claude --model haiku");
    // Older saved choices: one for everything is a recent drafter now, and
    // the setup's is the default; a fast one is the default.
    writeFileSync(saved, JSON.stringify({ harness: "opencode", model: "openai/gpt-6.1-sol" }));
    expect(atStart("nil")).toBe("claude default default");
    expect(expr(`require('rubric.drafts').load_saved().recent[1].model`)).toBe("openai/gpt-6.1-sol");
    writeFileSync(saved, JSON.stringify({ fast: { harness: "claude", model: "haiku" }, careful: { harness: "claude", model: "opus" } }));
    expect(atStart("nil")).toBe("claude haiku default");
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    await gone(dir);
  }
}, 60_000);
