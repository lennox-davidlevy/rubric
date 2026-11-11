// The plugin and the server in a real, headless Neovim, driven from outside
// over --listen so keys arrive the way a writer's do, with the stub resolver.
// Skipped when nvim is not on the path.

import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
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
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
