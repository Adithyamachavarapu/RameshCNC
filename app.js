const state = { data: null, query: "", section: "all", kind: "all", sort: "relevance", selected: null };
const $ = (id) => document.getElementById(id);

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/Ý/g, "tt").replace(/[ﬁ]/g, "fi").replace(/[ﬂ]/g, "fl").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function words(value) {
  return (String(value || "").toLowerCase().normalize("NFKD").replace(/Ý/g, "tt").match(/[a-z0-9]+/g) || []).filter((word) => word.length > 1);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatNumber(value) { return new Intl.NumberFormat("en-IN").format(value); }
function sectionById(id) { return state.data.sections.find((section) => section.id === id) || state.data.sections[0]; }
function itemById(id) { return state.data.items.find((item) => item.id === id); }
function pageByNumber(page) { return state.data.pages[page - 1]; }
function isHolder(item) { return item?.kind === "Tool holder / adapter"; }

function highlight(value) {
  const text = esc(value);
  const query = esc(state.query.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!query) return text;
  try { return text.replace(new RegExp(`(${query})`, "ig"), "<mark>$1</mark>"); } catch { return text; }
}

function setCoverage() {
  const { coverage } = state.data;
  $("footer-count").textContent = `${formatNumber(coverage.indexedPages)} pages · ${formatNumber(coverage.indexedIdentifiers)} identifiers linked`;
}

function setSectionSelect() {
  const sections = state.data.sections.filter((section) => !["frontmatter", "backmatter"].includes(section.id));
  $("section-select").innerHTML = `<option value="all">All product lines</option>` + sections.map((section) => `<option value="${esc(section.id)}">${esc(section.title)}</option>`).join("");
  $("section-select").value = state.section;
}

function setPageHeading(sectionId = state.section) {
  const heading = $("page-heading");
  const subheading = $("page-subheading");
  if (sectionId === "all") {
    heading.textContent = "TOOL HOLDERS & ADAPTERS";
    subheading.textContent = "Find the holder, insert or adapter that fits your tool.";
    return;
  }
  const section = sectionById(sectionId);
  heading.textContent = section.title.toUpperCase();
  subheading.textContent = section.description + ".";
}

function setCategoryButtons() {
  $("category-strip").querySelectorAll("[data-section]").forEach((button) => button.classList.toggle("active", state.section !== "all" && button.dataset.section === state.section));
}

function pageMatchesSection(page) { return state.section === "all" || page.sectionId === state.section; }

function scorePage(page, query, queryWords, compactQuery) {
  if (!pageMatchesSection(page)) return -1;
  if (!query) return 1;
  const title = normalize(page.title);
  const snippet = normalize(page.snippet);
  const haystack = page.search;
  let score = 0;
  if (title.includes(compactQuery)) score += 90;
  if (snippet.includes(compactQuery)) score += 35;
  if (page.codes.some((code) => normalize(code) === compactQuery)) score += 120;
  queryWords.forEach((word) => { if (haystack.includes(word)) score += 7; if (title.includes(word)) score += 14; });
  return score || -1;
}

function searchResults() {
  const query = state.query.trim();
  const compactQuery = normalize(query);
  const queryWords = words(query);
  const pages = state.data.pages.map((page) => ({ type: "page", page, score: scorePage(page, query, queryWords, compactQuery) })).filter((result) => result.score >= 0);
  const items = query ? state.data.items.map((item) => {
    if (state.section !== "all" && item.sectionId !== state.section) return null;
    if (state.kind !== "all" && item.kind !== state.kind) return null;
    const code = normalize(item.code);
    const match = code.includes(compactQuery) || (queryWords.length > 1 && queryWords.every((word) => code.includes(word)));
    if (!match) return null;
    const itemPages = item.pages.filter((page) => state.section === "all" || pageByNumber(page)?.sectionId === state.section);
    return itemPages.length ? { type: "item", item: { ...item, pages: itemPages }, score: code === compactQuery ? 260 : 160 } : null;
  }).filter(Boolean) : [];
  const sortItems = (a, b) => a.item.code.localeCompare(b.item.code);
  if (state.sort === "page") { items.sort((a, b) => a.item.firstPage - b.item.firstPage); pages.sort((a, b) => a.page.page - b.page.page); }
  else if (state.sort === "az") { items.sort(sortItems); pages.sort((a, b) => a.page.title.localeCompare(b.page.title)); }
  else { items.sort((a, b) => b.score - a.score || sortItems(a, b)); pages.sort((a, b) => b.score - a.score || a.page.page - b.page.page); }
  return { items: items.slice(0, query ? 35 : 0), pages: pages.slice(0, query ? 18 : 0), totalItems: items.length, totalPages: pages.length };
}

function kindLabel(item) { return item.kind || "Catalogue item"; }

function resultCard(result) {
  if (result.type === "item") {
    const item = result.item;
    const selected = state.selected?.type === "item" && state.selected.id === item.id;
    const section = sectionById(item.sectionId);
    return `<article class="result-card ${selected ? "selected" : ""}" data-type="item" data-id="${esc(item.id)}">
      <div><div class="result-meta"><span class="kind-pill">Item</span><span>·</span><span>${esc(kindLabel(item))}</span><span>·</span><span>${esc(section.title)}</span></div>
      <h3>${highlight(item.code)}</h3><p class="result-snippet">Appears on ${item.pages.length} catalogue page${item.pages.length === 1 ? "" : "s"}. Select it to see the recommended pairing and reverse lookup.</p></div>
      <div class="result-aside"><span>p.${item.firstPage}</span><span class="result-arrow">›</span></div>
    </article>`;
  }
  const page = result.page;
  const selected = state.selected?.type === "page" && state.selected.id === page.id;
  return `<article class="result-card ${selected ? "selected" : ""}" data-type="page" data-id="${esc(page.id)}">
    <div><div class="result-meta"><span class="kind-pill">Source page</span><span>·</span><span>${esc(sectionById(page.sectionId).title)}</span><span class="page-pill">· p.${page.page}</span></div>
    <h3>${highlight(page.title)}</h3><p class="result-snippet">${highlight(page.snippet)}</p></div><div class="result-aside"><span>p.${page.page}</span><span class="result-arrow">›</span></div>
  </article>`;
}

function welcomeMarkup() {
  return `<div class="welcome-box"><div class="welcome-head"><span class="welcome-check">1</span><div><h3>Start with the code on the item</h3><p>For example: CCMT060202, SCLCR/L, BT40 or DEEP-LINE.</p></div></div><div class="workflow"><div><b>1</b><span>Type the code</span></div><div><b>2</b><span>Click the item</span></div><div><b>3</b><span>Use the matching item on the right</span></div></div><div class="simple-note"><span>Tip</span> If you search a holder, the matching inserts/tools will be shown. If you search an insert, the matching holder will be shown.</div></div>`;
}

function renderResults() {
  const results = searchResults();
  const hasQuery = Boolean(state.query.trim());
  $("results-kicker").textContent = hasQuery ? `Results for “${state.query.trim()}”` : state.section === "all" ? "Your results" : sectionById(state.section).title;
  $("results-title").textContent = hasQuery ? `${formatNumber(results.totalItems + results.totalPages)} matches found` : "Type something above to begin";
  if (!hasQuery) { $("results-grid").innerHTML = welcomeMarkup(); bindResultActions(); return; }
  let html = "";
  if (results.items.length) html += `<div class="result-group-title">Items <span>${formatNumber(results.totalItems)} matches</span></div>${results.items.map(resultCard).join("")}`;
  if (results.pages.length) html += `<div class="result-group-title">Source pages <span>${formatNumber(results.totalPages)} matches</span></div>${results.pages.map(resultCard).join("")}`;
  $("results-grid").innerHTML = html || `<div class="empty-results"><strong>No catalogue match</strong><span>Try a shorter code, a product family, or a material such as “stainless”.</span></div>`;
  bindResultActions();
}

function bindResultActions() {
  $("results-grid").querySelectorAll("[data-type]").forEach((card) => card.addEventListener("click", () => { state.selected = { type: card.dataset.type, id: card.dataset.id }; renderResults(); renderDetail(); if (state.selected.type === "item") openItemDialog(itemById(state.selected.id)); else if (window.innerWidth < 1180) $("detail-panel").scrollIntoView({ behavior: "smooth", block: "start" }); }));
  $("results-grid").querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => { state.section = button.dataset.section; state.selected = null; setSectionSelect(); setPageHeading(); setCategoryButtons(); renderResults(); renderDetail(); }));
}

function relationFor(item) {
  const candidates = new Map();
  const add = (candidate, page, label, explicit) => {
    if (!candidate || candidate.id === item.id) return;
    const existing = candidates.get(candidate.id) || { item: candidate, pages: new Set(), labels: new Set(), explicit: false };
    existing.pages.add(page); if (label) existing.labels.add(label); existing.explicit ||= explicit; candidates.set(candidate.id, existing);
  };
  state.data.relations.forEach((relation) => {
    if (relation.from !== item.id && relation.to !== item.id) return;
    const target = itemById(relation.from === item.id ? relation.to : relation.from);
    add(target, relation.page, relation.label, true);
  });
  item.pages.forEach((pageNumber) => {
    const page = pageByNumber(pageNumber);
    page?.codes.forEach((code) => add(itemById(normalize(code)), pageNumber, "Same catalogue page", false));
  });
  let list = [...candidates.values()];
  const preferred = isHolder(item) ? (candidate) => candidate.item.kind !== "Tool holder / adapter" : (candidate) => candidate.item.kind === "Tool holder / adapter";
  const primary = list.filter(preferred);
  const secondary = list.filter((candidate) => !preferred(candidate));
  const rank = (a, b) => Number(b.explicit) - Number(a.explicit) || b.pages.size - a.pages.size || a.item.code.localeCompare(b.item.code);
  primary.sort(rank); secondary.sort(rank);
  return { primary: primary.slice(0, 16), secondary: secondary.slice(0, 8) };
}

function evidenceText(candidate) {
  const label = [...candidate.labels][0];
  if (candidate.explicit && label) return label.length > 110 ? `${label.slice(0, 107)}…` : label;
  return "Printed on the same catalogue page";
}

function relatedCard(candidate) {
  const item = candidate.item;
  return `<button class="related-item" data-related-action="item:${esc(item.id)}"><div><strong>${esc(item.code)}</strong><span>${esc(kindLabel(item))} · ${evidenceText(candidate)}</span></div><small>p.${Math.min(...candidate.pages)}</small></button>`;
}

function closeItemDialog() {
  $("item-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
}

function openItemDialog(item) {
  if (!item) return;
  const related = relationFor(item);
  const section = sectionById(item.sectionId);
  const gradeText = item.grades?.length ? item.grades.join(" · ") : "Not stated on source page";
  $("dialog-title").textContent = item.code;
  $("dialog-subtitle").textContent = `${section.title} · source page ${item.firstPage}`;
  $("dialog-type").textContent = kindLabel(item);
  $("dialog-table").innerHTML = `
    <div class="dialog-table-head"><span>Catalog No.</span><span>Designation</span><span>Grade</span><span>Item type</span></div>
    <div class="dialog-table-row"><strong>${esc(item.catalogNo || item.code)}</strong><strong>${esc(item.designation || item.code)}</strong><span>${esc(gradeText)}</span><span>${esc(kindLabel(item))}</span></div>`;
  const primaryTitle = isHolder(item) ? "Tools and inserts for this holder" : "Tool holder / adapter for this item";
  $("dialog-related-title").textContent = primaryTitle;
  const primary = related.primary.length ? related.primary : related.secondary;
  $("dialog-related-list").innerHTML = primary.length ? primary.slice(0, 12).map((candidate) => `<button class="dialog-related-card" data-dialog-item="${esc(candidate.item.id)}"><span><strong>${esc(candidate.item.code)}</strong><small>${esc(kindLabel(candidate.item))} · ${esc(evidenceText(candidate))}</small></span><b>p.${Math.min(...candidate.pages)} ›</b></button>`).join("") : `<div class="dialog-no-related">No matching item was printed on the same source page. Open the source page for the full catalogue context.</div>`;
  $("dialog-source").innerHTML = `<span>Source: Unitec catalogue page ${item.firstPage}</span><button type="button" data-dialog-page="${item.firstPage}">Open source page →</button>`;
  $("item-dialog").hidden = false;
  document.body.classList.add("dialog-open");
  bindDialogActions();
}

function bindDialogActions() {
  $("item-dialog").querySelectorAll("[data-dialog-item]").forEach((button) => button.addEventListener("click", () => {
    const item = itemById(button.dataset.dialogItem);
    if (item) { state.selected = { type: "item", id: item.id }; renderResults(); renderDetail(); openItemDialog(item); }
  }));
  $("item-dialog").querySelectorAll("[data-dialog-page]").forEach((button) => button.addEventListener("click", () => {
    closeItemDialog();
    const page = pageByNumber(Number(button.dataset.dialogPage));
    if (page) { state.selected = { type: "page", id: page.id }; renderResults(); renderDetail(); }
  }));
}

function renderItemDetail(item) {
  const section = sectionById(item.sectionId);
  const related = relationFor(item);
  const primaryTitle = isHolder(item) ? "2. Tools and inserts for this holder" : "2. Use this holder / adapter";
  const primaryNote = isHolder(item) ? "These are the tools and inserts printed with this holder in the catalogue." : "This is the holder or adapter printed with this item in the catalogue.";
  const sourcePage = pageByNumber(item.firstPage);
  $("detail-panel").innerHTML = `<div class="detail-content">
    <div class="detail-header"><div class="result-meta"><span class="kind-pill">Selected item</span><span>·</span><span>${esc(section.title)}</span><span class="page-pill">· p.${item.firstPage}</span></div><h3>${esc(item.code)}</h3><div class="detail-kind">${esc(kindLabel(item))}</div><p>Found on ${item.pages.length} catalogue page${item.pages.length === 1 ? "" : "s"}. Pairings below come from catalogue relationships or shared source pages.</p><button class="source-link" data-related-action="page:${item.firstPage}">Open source page →</button></div>
    <section class="detail-section"><h4>${esc(primaryTitle)}</h4><div class="pairing-callout"><strong>Use this first</strong><br />${esc(primaryNote)}</div><div class="related-list">${related.primary.length ? related.primary.map(relatedCard).join("") : `<div class="related-empty">No direct pairing was detected on the item’s source pages. Try opening the source page for the full catalogue context.</div>`}</div></section>
    <section class="detail-section"><h4>Other catalogue matches</h4><p class="detail-section-note">Additional identifiers printed on the same source pages. Selecting one switches the lookup around.</p><div class="related-list">${related.secondary.length ? related.secondary.slice(0, 6).map(relatedCard).join("") : `<div class="related-empty">No additional related identifiers found.</div>`}</div></section>
    <section class="detail-section"><h4>Source text · page ${sourcePage.page}</h4><div class="source-box">${esc(sourcePage.text)}</div></section>
  </div>`;
  bindDetailActions();
}

function renderPageDetail(page) {
  const section = sectionById(page.sectionId);
  const itemButtons = page.codes.slice(0, 24).map((code) => `<button class="code-chip" data-related-action="item:${esc(normalize(code))}">${esc(code)}</button>`).join("");
  $("detail-panel").innerHTML = `<div class="detail-content"><div class="detail-header"><div class="result-meta"><span class="kind-pill">Source page</span><span>·</span><span>${esc(section.title)}</span><span class="page-pill">· p.${page.page}</span></div><h3>${esc(page.title)}</h3><p>${esc(section.description)}. This page is the source used by the search index.</p></div>${itemButtons ? `<section class="detail-section"><h4>Items on this page</h4><div class="code-strip">${itemButtons}</div></section>` : ""}<section class="detail-section"><h4>Source text</h4><div class="source-box">${esc(page.text)}</div></section></div>`;
  bindDetailActions();
}

function bindDetailActions() {
  $("detail-panel").querySelectorAll("[data-related-action]").forEach((button) => button.addEventListener("click", () => {
    const [type, id] = button.dataset.relatedAction.split(":");
    if (type === "page") { const page = pageByNumber(Number(id)); if (page) state.selected = { type: "page", id: page.id }; }
    else { const item = itemById(id); if (item) state.selected = { type: "item", id: item.id }; }
    renderResults(); renderDetail();
  }));
}

function renderDetail() {
  if (!state.selected) { $("detail-panel").innerHTML = `<div class="detail-empty"><div class="empty-symbol">2</div><h3>Choose an item</h3><p>After you select a result, the holder or insert that goes with it will appear here.</p></div>`; return; }
  if (state.selected.type === "item") { const item = itemById(state.selected.id); if (item) return renderItemDetail(item); }
  if (state.selected.type === "page") { const page = state.data.pages.find((candidate) => candidate.id === state.selected.id); if (page) return renderPageDetail(page); }
  state.selected = null; renderDetail();
}

function applyQuery(value) {
  state.query = value;
  state.selected = null;
  renderResults();
  renderDetail();
  $("clear-search").classList.toggle("visible", Boolean(state.query));
  const exact = state.data?.items.find((item) => normalize(item.code) === normalize(value) && (state.section === "all" || item.sectionId === state.section) && (state.kind === "all" || item.kind === state.kind));
  if (exact) { state.selected = { type: "item", id: exact.id }; renderResults(); renderDetail(); openItemDialog(exact); }
}

async function init() {
  try {
    state.data = await fetch("data/catalogue.json?v=3").then((response) => { if (!response.ok) throw new Error(`Catalogue data error ${response.status}`); return response.json(); });
  } catch (error) { $("results-grid").innerHTML = `<div class="empty-results"><strong>Catalogue data could not load</strong><span>Start the site with a local web server so data/catalogue.json can be read.</span></div>`; return; }
  setCoverage(); setSectionSelect(); setPageHeading(); setCategoryButtons(); renderResults(); renderDetail();
  const input = $("search-input");
  input.addEventListener("input", (event) => applyQuery(event.target.value));
  $("search-submit").addEventListener("click", () => { input.focus(); applyQuery(input.value); });
  $("clear-search").addEventListener("click", () => { input.value = ""; input.focus(); applyQuery(""); });
  $("quick-searches").querySelectorAll("[data-query]").forEach((button) => button.addEventListener("click", () => { input.value = button.dataset.query; applyQuery(button.dataset.query); input.focus(); }));
  $("category-strip").querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => { state.section = button.dataset.section; state.selected = null; setSectionSelect(); setPageHeading(); setCategoryButtons(); renderResults(); renderDetail(); }));
  $("section-select").addEventListener("change", (event) => { state.section = event.target.value; state.selected = null; setPageHeading(); setCategoryButtons(); renderResults(); renderDetail(); });
  $("kind-select").addEventListener("change", (event) => { state.kind = event.target.value; state.selected = null; renderResults(); renderDetail(); });
  $("sort-select").addEventListener("change", (event) => { state.sort = event.target.value; renderResults(); });
  $("reset-filters").addEventListener("click", () => { state.section = "all"; state.kind = "all"; state.query = ""; state.selected = null; input.value = ""; setSectionSelect(); $("kind-select").value = "all"; setPageHeading(); setCategoryButtons(); renderResults(); renderDetail(); });
  $("item-dialog").querySelectorAll("[data-close-dialog]").forEach((element) => element.addEventListener("click", closeItemDialog));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("item-dialog").hidden) closeItemDialog(); });
  document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== input) { event.preventDefault(); input.focus(); } if (event.key === "Enter" && document.activeElement === input) applyQuery(input.value); if (event.key === "Escape" && document.activeElement === input) { input.value = ""; applyQuery(""); } });
}

init();
