// tabs: makes each panel's heading a tab, one panel shown at a time, with
// the arrow keys moving between tabs. Without it the panels read as headings
// and sections, so nothing is lost.
document.querySelectorAll(".part-tabs").forEach((root, n) => {
  const panels = [...root.querySelectorAll(":scope > .part-tabs-panel")];
  if (panels.length < 2) return;
  const list = document.createElement("div");
  list.className = "part-tabs-list";
  list.setAttribute("role", "tablist");
  const tabs = panels.map((panel, i) => {
    const title = panel.querySelector(":scope > .part-tabs-title");
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `rubric-tab-${n}-${i}`;
    tab.setAttribute("role", "tab");
    tab.innerHTML = title.innerHTML;
    panel.id ||= `rubric-tabpanel-${n}-${i}`;
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    title.hidden = true;
    list.append(tab);
    return tab;
  });
  root.prepend(list);
  root.classList.add("is-tabbed");
  const select = (i, focus) => {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
      panels[j].hidden = i !== j;
    });
    if (focus) tabs[i].focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) select((i + step + tabs.length) % tabs.length, true);
      else if (e.key === "Home") select(0, true);
      else if (e.key === "End") select(tabs.length - 1, true);
      else return;
      e.preventDefault();
    });
  });
  select(0);
});
