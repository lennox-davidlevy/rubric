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
    expect(html).not.toContain("has-icon");
    expect(html).toContain("<p>A larger opening.</p>");

    const bad = build(`{{< callout nonsense="x" >}}\nHello.\n{{< /callout >}}`);
    expect(bad.exitCode).not.toBe(0);
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
});
