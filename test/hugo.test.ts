// Builds every fixture's content with Hugo and the slice catalog, so the
// preprocessor can never write a shortcode call that the catalog's shortcodes
// reject. Skipped when hugo is not on the path.

import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureNames, runFixture } from "./fixtures.ts";

const root = join(import.meta.dir, "..");
const hugo = Bun.which("hugo");

test.skipIf(!hugo)("every fixture builds in Hugo", () => {
  const site = mkdtempSync(join(tmpdir(), "rubric-hugo-"));
  try {
    writeFileSync(
      join(site, "hugo.toml"),
      readFileSync(join(root, "sites/slice/hugo.toml"), "utf8").replace(
        /^themesDir = .*$/m,
        `themesDir = ${JSON.stringify(join(root, "catalogs"))}`,
      ),
    );
    mkdirSync(join(site, "content/posts"), { recursive: true });
    for (const name of fixtureNames()) {
      writeFileSync(join(site, "content/posts", `${name}.md`), runFixture(name).content);
    }

    const build = Bun.spawnSync([hugo!, "--quiet", "-s", site, "-d", join(site, "public")]);
    expect(build.stderr.toString()).toBe("");
    expect(build.exitCode).toBe(0);

    const nested = readFileSync(join(site, "public/posts/nested/index.html"), "utf8");
    expect(nested).toContain(`<section class="part-section tone-dark surface-flat shadow-deep">`);
    expect(nested).toContain(`<aside class="part-callout kind-aside">`);
    const words = readFileSync(join(site, "public/posts/words/index.html"), "utf8");
    expect(words).toContain(`<figure class="part-quote size-large align-center">`);
    expect(words).toContain("::: a spreadsheet of my taxes");
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

// When the theme changes in hugo.toml, Hugo rebuilds with the new skin a
// moment before Rubric rewrites the page, so for that build the page can
// still hold another skin's parts and settings. That build must not fail:
// a failed build left the old theme's page in the browser.
test.skipIf(!hugo)("a part or setting another skin brings is left out, not an error", () => {
  const site = mkdtempSync(join(tmpdir(), "rubric-hugo-skin-"));
  const build = (body: string) => {
    writeFileSync(join(site, "content/posts/p.md"), `---\ntitle: P\n---\n\n${body}\n`);
    return Bun.spawnSync([hugo!, "--quiet", "-s", site, "-d", join(site, "public")]);
  };
  try {
    writeFileSync(
      join(site, "hugo.toml"),
      readFileSync(join(root, "testing/hugo.toml"), "utf8")
        .replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(root, "catalogs"))}`)
        .replace(/^theme = "(?!universal).*"$/m, `theme = "paper"`),
    );
    mkdirSync(join(site, "content/posts"), { recursive: true });

    const ok = build(`{{< callout kind="tip" icon="lightbulb" >}}\nHello.\n{{< /callout >}}\n\n{{< lead >}}\nA larger opening.\n{{< /lead >}}`);
    expect(ok.stderr.toString()).toBe("");
    expect(ok.exitCode).toBe(0);
    const html = readFileSync(join(site, "public/posts/p/index.html"), "utf8");
    expect(html).toContain(`class="part part-callout kind-tip"`);
    // The icon is the catalog's, so every skin draws it; only Blowfish marks it has-icon.
    expect(html).toContain(`class="part-callout-icon"`);
    expect(html).not.toContain("has-icon");
    expect(html).toContain(`class="part part-lead"`);
    expect(html).toContain("<p>A larger opening.</p>");

    const bad = build(`{{< callout nonsense="x" >}}\nHello.\n{{< /callout >}}`);
    expect(bad.exitCode).not.toBe(0);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

// The parts the imported themes brought: each reads its plain block, and says
// so when the block has nothing it can use.
test.skipIf(!hugo)("a map, a PDF, a file tree and progress bars draw from their blocks", () => {
  const site = mkdtempSync(join(tmpdir(), "rubric-hugo-parts-"));
  try {
    writeFileSync(
      join(site, "hugo.toml"),
      readFileSync(join(root, "testing/hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(root, "catalogs"))}`),
    );
    mkdirSync(join(site, "content/posts"), { recursive: true });
    writeFileSync(
      join(site, "content/posts/p.md"),
      [
        "---", "title: P", "---", "",
        `{{< map zoom="street" >}}\n51.5055, -0.0754\n\nBy the river.\n{{< /map >}}`,
        "{{< map >}}\nsomewhere nice\n{{< /map >}}",
        "{{< pdf >}}\n/files/route.pdf\n\nThe route.\n{{< /pdf >}}",
        "{{< file-tree >}}\n- pages/\n  - about.md\n- hugo.toml\n{{< /file-tree >}}",
        "{{< progress >}}\n- Miles: 72%\n- Too many: 140%\n{{< /progress >}}",
      ].join("\n\n"),
    );
    const build = Bun.spawnSync([hugo!, "--quiet", "-s", site, "-d", join(site, "public")]);
    expect(build.stderr.toString()).toBe("");
    const html = readFileSync(join(site, "public/posts/p/index.html"), "utf8");
    expect(html).toContain(`class="part part-map zoom-street"`);
    expect(html).toMatch(/embed\.html\?bbox=-0\.0799.*marker=51\.50550/);
    expect(html).toContain("By the river.");
    expect(html).toContain("This map needs its place as a first line");
    expect(html).toContain(`data="/files/route.pdf"`);
    expect(html).toContain(`<li class="is-folder">pages/`);
    expect(html).not.toContain(`<li class="is-folder">hugo.toml`);
    expect(html).toContain(`aria-valuenow="72"`);
    expect(html).toContain(`<span>Miles</span>`);
    expect(html).toContain(`aria-valuenow="100"`);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});

// A link in an embed is drawn as a chat app draws a shared one: the page's
// title, description and picture, the picture copied into the site. A page
// that gives none, or a fetch that fails, leaves the plain card. Served from
// here, so the test needs no network.
test.skipIf(!hugo)("an embed's link shows the page's title, description and picture, from the site's oEmbed address when it has one", async () => {
  const png = await Bun.file(join(root, "testing/static/images/path.png")).bytes();
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/talk") {
        return new Response(
          `<html><head><title>Fallback</title><meta content="The talk &amp; its slides" property="og:title">` +
          `<meta name='description' content='Forty slides on walking home.'><meta property="og:image" content="/pic.png"></head><body>Hi</body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      if (path === "/titled") return new Response("<html><head><title>Only a title</title></head></html>", { headers: { "Content-Type": "text/html" } });
      // A site that turns away a request for the page, as Reddit does, and
      // answers at its oEmbed address instead.
      if (path.startsWith("/walls/")) return new Response("go away", { status: 403 });
      if (path === "/oembed") {
        const asked = new URL(req.url).searchParams;
        if (asked.get("format") !== "json" || !asked.get("url")?.includes("/walls/")) return new Response("bad", { status: 400 });
        return Response.json({ type: "rich", title: "Behind a wall", author_name: "A. Writer", thumbnail_url: "/pic.png" });
      }
      if (path === "/pic.png") return new Response(png, { headers: { "Content-Type": "image/png" } });
      return new Response("not here", { status: 404 });
    },
  });
  const at = `http://127.0.0.1:${server.port}`;
  const site = mkdtempSync(join(tmpdir(), "rubric-hugo-embed-"));
  try {
    writeFileSync(
      join(site, "hugo.toml"),
      readFileSync(join(root, "testing/hugo.toml"), "utf8").replace(/^themesDir = .*$/m, `themesDir = ${JSON.stringify(join(root, "catalogs"))}`) +
        // Hugo fetches from no IP address unless a site allows it.
        `\n[security.http]\nurls = ["^http://127\\\\.0\\\\.0\\\\.1:"]\n`,
    );
    mkdirSync(join(site, "content/posts"), { recursive: true });
    // The site's own registry, in place of the catalog's, naming the stand-in.
    mkdirSync(join(site, "data"));
    writeFileSync(join(site, "data/oembed.json"), JSON.stringify([
      { provider_name: "Walls", provider_url: at, endpoints: [{ schemes: [`${at}/walls/*`], url: `${at}/oembed` }] },
    ]));
    writeFileSync(
      join(site, "content/posts/p.md"),
      ["---", "title: P", "---", "",
        `{{< embed >}}\n${at}/walls/post\n{{< /embed >}}`,
        `{{< embed >}}\n${at}/talk\n{{< /embed >}}`,
        `{{< embed >}}\n${at}/titled\n{{< /embed >}}`,
        `{{< embed >}}\n${at}/gone\n{{< /embed >}}`,
      ].join("\n\n"),
    );
    const build = Bun.spawn([hugo!, "--quiet", "-s", site, "-d", join(site, "public"), "--cacheDir", join(site, "cache")], { stderr: "pipe" });
    await build.exited;
    expect(await new Response(build.stderr).text()).toBe("");
    const html = readFileSync(join(site, "public/posts/p/index.html"), "utf8");
    const walled = html.split(`<a class="part-embed-card`).slice(1);
    expect(walled).toHaveLength(4);
    expect(walled[0]).toContain(`<span class="part-embed-title">Behind a wall</span>`);
    expect(walled[0]).toContain(`<span class="part-embed-description">By A. Writer</span>`);
    expect(walled[0]).toContain(`<img class="part-embed-image"`);
    const cards = walled.slice(1);
    expect(cards[0]).toContain(`<span class="part-embed-title">The talk &amp; its slides</span>`);
    expect(cards[0]).toContain(`<span class="part-embed-description">Forty slides on walking home.</span>`);
    expect(cards[0]).toMatch(/<img class="part-embed-image" src="\/pic_[^"]+\.png" width="\d+" height="\d+"/);
    expect(cards[1]).toContain(`<span class="part-embed-title">Only a title</span>`);
    expect(cards[1]).not.toContain("<img");
    expect(cards[2]).toContain(`<span class="part-embed-url">${at}/gone</span>`);
    expect(cards[2]).not.toContain("part-embed-title");
  } finally {
    server.stop(true);
    rmSync(site, { recursive: true, force: true });
  }
});

