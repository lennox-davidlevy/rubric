// The plugin and the server in a real, headless Neovim, driven from outside
// over --listen so keys arrive the way a writer's do, with the stub resolver.
// Skipped when nvim is not on the path.

import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

    // Typing a new line: completion offers the parts after "::: ".
    keys("Go::: <Esc>");
    await Bun.sleep(400);
    expect(expr("RubricTest.complete(8, 4)")).toBe("callout,quote,section");
    keys("dd");

    // Insert mode at the end of the words line: the ghost text appears, and
    // the plugin's accept key pins the line.
    keys(":call cursor(2, 1)<CR>A");
    // A writer stops typing; Neovim asks 200 ms later.
    await Bun.sleep(600);
    // (remote output is trimmed, so the ghost's leading space is not compared.)
    expect(await until(() => expr("RubricTest.ghost()") === "-> quote size=large")).toBe(true);
    keys("<M-l>");
    expect(await until(() => expr("RubricTest.line(2)") === "::: a big quote please -> quote size=large")).toBe(true);
    keys("<Esc>");

    // The server reads the line as pinned, and places it.
    const sidecar = join(site, ".rubric/sidecar/posts/smoke.md.json");
    expect(await until(() => {
      try {
        const [first] = JSON.parse(readFileSync(sidecar, "utf8"));
        return first.kind === "pinned" && first.placed === true;
      } catch {
        return false;
      }
    })).toBe(true);
    expect(readFileSync(join(site, "content/posts/smoke.md"), "utf8").split("\n")[1]).toBe(`{{< quote size="large" >}}`);
  } finally {
    keys("<Esc>:qa!<CR>");
    await Promise.race([editor.exited, Bun.sleep(2000)]);
    editor.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
