// ---------- logout ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {
    // ignore network errors, still send them to the login page
  }
  window.location.href = "/login.html";
});

// ---------- tab switching ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("is-active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("is-active");
    if (btn.dataset.tab === "label") loadNextEntry();
    if (btn.dataset.tab === "export") loadExportStats();
    if (btn.dataset.tab === "create") loadItems();
  });
});

// ---------- helpers ----------
async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function lowerFirst(s) {
  if (!s) return s;
  if (s === s.toUpperCase()) return s; // leave acronyms alone
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function stripLeadingVerb(phrase) {
  return phrase.trim().replace(/^(i\s+(can|could|will|offer|teach|know)\s+)/i, "").trim();
}

function offerVariants(phrase) {
  const p = lowerFirst(stripLeadingVerb(phrase));
  const capped = p.charAt(0).toUpperCase() + p.slice(1);
  return [
    `I can offer ${p}.`,
    `I'm happy to help with ${p}.`,
    `I have experience with ${p} and can teach it.`,
    `I offer ${p} for anyone interested.`,
    `${capped} is something I can share with others.`,
    `I know ${p} well and can walk someone through it.`,
    `Count me in to help with ${p}.`,
    `I can put together a session on ${p}.`,
    `Happy to run a beginner-friendly session on ${p}.`,
  ];
}
function wantVariants(phrase) {
  const p = lowerFirst(stripLeadingVerb(phrase));
  return [
    `I want ${p}.`,
    `I'm looking for help with ${p}.`,
    `I need someone who can help me with ${p}.`,
    `I'd love to learn more about ${p}.`,
    `Looking for guidance on ${p}.`,
    `I need a hand with ${p}.`,
    `Could really use help with ${p}.`,
    `I'm hoping to find someone who can teach me ${p}.`,
    `Would appreciate any pointers on ${p}.`,
  ];
}

function randomIndexExcluding(length, exclude) {
  if (length <= 1) return 0;
  let idx;
  do {
    idx = Math.floor(Math.random() * length);
  } while (idx === exclude);
  return idx;
}

// Local ISO timestamp with the browser's own UTC offset, e.g. 2026-08-19T18:44:13.269-07:00
function formatLocalISO(d) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// ---------- CREATE panel ----------
let offerIdx = 0;
let wantIdx = 0;

document.getElementById("draft-btn").addEventListener("click", () => {
  const phrase = document.getElementById("phrase-input").value.trim();
  if (!phrase) return;
  const offers = offerVariants(phrase);
  const wants = wantVariants(phrase);
  offerIdx = Math.floor(Math.random() * offers.length);
  wantIdx = Math.floor(Math.random() * wants.length);
  document.getElementById("offer-text").value = offers[offerIdx];
  document.getElementById("want-text").value = wants[wantIdx];
  document.getElementById("offer-variant-count").textContent = `(1/${offers.length})`;
  document.getElementById("want-variant-count").textContent = `(1/${wants.length})`;
  document.getElementById("draft-area").hidden = false;
  document.getElementById("draft-area").dataset.phrase = phrase;
});

document.getElementById("cycle-offer").addEventListener("click", () => {
  const phrase = document.getElementById("draft-area").dataset.phrase || "";
  const variants = offerVariants(phrase);
  offerIdx = randomIndexExcluding(variants.length, offerIdx);
  document.getElementById("offer-text").value = variants[offerIdx];
  document.getElementById("offer-variant-count").textContent = `(${offerIdx + 1}/${variants.length})`;
});
document.getElementById("cycle-want").addEventListener("click", () => {
  const phrase = document.getElementById("draft-area").dataset.phrase || "";
  const variants = wantVariants(phrase);
  wantIdx = randomIndexExcluding(variants.length, wantIdx);
  document.getElementById("want-text").value = variants[wantIdx];
  document.getElementById("want-variant-count").textContent = `(${wantIdx + 1}/${variants.length})`;
});

document.getElementById("save-draft-btn").addEventListener("click", async () => {
  const phrase = document.getElementById("draft-area").dataset.phrase || "";
  const items = [];
  if (document.getElementById("offer-include").checked) {
    items.push({ text: document.getElementById("offer-text").value.trim(), type: "offer", source_phrase: phrase });
  }
  if (document.getElementById("want-include").checked) {
    items.push({ text: document.getElementById("want-text").value.trim(), type: "want", source_phrase: phrase });
  }
  if (items.length === 0) return;
  const statusEl = document.getElementById("create-status");
  try {
    await api("/items", { method: "POST", body: JSON.stringify({ items }) });
    statusEl.textContent = `Saved ${items.length} item(s) to the bank.`;
    document.getElementById("phrase-input").value = "";
    document.getElementById("draft-area").hidden = true;
    loadItems();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
});

async function loadItems() {
  const { items } = await api("/items");
  const offers = items.filter((i) => i.type === "offer");
  const wants = items.filter((i) => i.type === "want");
  document.getElementById("offer-count").textContent = offers.length;
  document.getElementById("want-count").textContent = wants.length;
  renderItemList("offer-list", offers);
  renderItemList("want-list", wants);
}

function renderItemList(elId, list) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  for (const item of list) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = item.text;
    const btn = document.createElement("button");
    btn.textContent = "remove";
    btn.addEventListener("click", async () => {
      await api(`/items?id=${item.id}`, { method: "DELETE" });
      loadItems();
    });
    li.append(span, btn);
    el.appendChild(li);
  }
}

// ---------- GENERATE panel ----------
document.getElementById("generate-btn").addEventListener("click", async () => {
  const count = Number(document.getElementById("gen-count").value) || 30;
  const statusEl = document.getElementById("generate-status");
  statusEl.textContent = "Generating…";
  try {
    const res = await api("/generate", { method: "POST", body: JSON.stringify({ count }) });
    statusEl.textContent = res.exhausted
      ? `Generated ${res.generated} of ${res.requested} requested — item bank is running low on new combinations.`
      : `Generated ${res.generated} combinations.`;
    renderBucketGrid(res.bucketCounts);
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
});

function renderBucketGrid(counts) {
  const el = document.getElementById("bucket-grid");
  el.innerHTML = "";
  const values = [];
  for (let o = 1; o <= 3; o++) for (let w = 1; w <= 3; w++) values.push((counts && counts[`${o}x${w}`]) || 0);
  const max = Math.max(1, ...values);
  for (let o = 1; o <= 3; o++) {
    for (let w = 1; w <= 3; w++) {
      const key = `${o}x${w}`;
      const n = (counts && counts[key]) || 0;
      const cell = document.createElement("div");
      cell.className = "bucket-cell";
      cell.innerHTML = `<div class="bar" style="height:${(n / max) * 100}%"></div><span class="n">${n}</span>${o} offer${o > 1 ? "s" : ""} × ${w} want${w > 1 ? "s" : ""}`;
      el.appendChild(cell);
    }
  }
}
renderBucketGrid({});

// ---------- LABEL panel ----------
const HIGHLIGHT_COLORS = ["#FDE68A", "#BFDBFE", "#FBCFE8", "#BBF7D0", "#DDD6FE", "#FED7AA"];

const labelerInput = document.getElementById("labeler-name");
labelerInput.value = localStorage.getItem("mira_labeler_name") || "";
labelerInput.addEventListener("input", () => {
  localStorage.setItem("mira_labeler_name", labelerInput.value);
});

let currentEntry = null;

async function loadNextEntry() {
  const { entries, counts } = await api("/entries?status=unlabeled&limit=1");
  const total = counts.total || 0;
  const done = total - (counts.unlabeled || 0);
  document.getElementById("label-progress").textContent = `${counts.unlabeled || 0} unlabeled · ${total} total`;
  document.getElementById("progress-fill").style.width = total ? `${(done / total) * 100}%` : "0%";
  if (entries.length === 0) {
    currentEntry = null;
    document.getElementById("label-card").hidden = true;
    document.getElementById("label-empty").hidden = false;
    return;
  }
  document.getElementById("label-empty").hidden = true;
  const card = document.getElementById("label-card");
  card.hidden = false;
  card.classList.add("is-loading");
  currentEntry = entries[0];
  await renderEntry(currentEntry);
  requestAnimationFrame(() => card.classList.remove("is-loading"));
}

function tokenize(text) {
  const stop = new Set(["i", "a", "an", "the", "to", "for", "with", "and", "of", "on", "in", "my", "me", "want", "need", "can", "help", "someone", "who", "looking"]);
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)))];
}

function highlightSharedTerms(texts) {
  // Build token -> list of item indices it appears in
  const tokensByItem = texts.map(tokenize);
  const tokenItems = {};
  tokensByItem.forEach((toks, idx) => {
    toks.forEach((t) => {
      (tokenItems[t] = tokenItems[t] || new Set()).add(idx);
    });
  });
  const sharedTokens = Object.keys(tokenItems).filter((t) => tokenItems[t].size > 1);
  const colorFor = {};
  sharedTokens.forEach((t, i) => (colorFor[t] = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]));

  return texts.map((text) => {
    const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    if (sharedTokens.length === 0) return escaped;
    const pattern = new RegExp(`\\b(${sharedTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    return escaped.replace(pattern, (m) => `<mark style="background:${colorFor[m.toLowerCase()]}">${m}</mark>`);
  });
}

async function renderEntry(entry) {
  const allTexts = [...entry.offers, ...entry.wants];
  const highlighted = highlightSharedTerms(allTexts);
  const highlightedOffers = highlighted.slice(0, entry.offers.length);
  const highlightedWants = highlighted.slice(entry.offers.length);

  const showZh = document.getElementById("translate-toggle").checked;
  let zhMap = {};
  if (showZh) {
    try {
      const res = await api("/translate", { method: "POST", body: JSON.stringify({ texts: allTexts }) });
      zhMap = res.translations || {};
    } catch (_) {
      zhMap = {};
    }
  }

  renderEntryColumn("entry-offers", entry.offers, highlightedOffers, zhMap, showZh);
  renderEntryColumn("entry-wants", entry.wants, highlightedWants, zhMap, showZh);
}

function renderEntryColumn(elId, texts, highlightedTexts, zhMap, showZh) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  texts.forEach((text, i) => {
    const div = document.createElement("div");
    div.className = "entry-item";
    const en = document.createElement("div");
    en.className = "en";
    en.innerHTML = highlightedTexts[i];
    div.appendChild(en);
    if (showZh && zhMap[text]) {
      const zh = document.createElement("div");
      zh.className = "zh";
      zh.textContent = zhMap[text];
      div.appendChild(zh);
    }
    el.appendChild(div);
  });
}

document.getElementById("translate-toggle").addEventListener("change", () => {
  if (currentEntry) renderEntry(currentEntry);
});

async function submitLabel(label) {
  if (!currentEntry) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) {
    labelerInput.focus();
    return;
  }
  const feedback = document.getElementById("label-feedback");
  const yesIcon = document.getElementById("feedback-yes-icon");
  const noIcon = document.getElementById("feedback-no-icon");
  yesIcon.hidden = label !== "yes";
  noIcon.hidden = label !== "no";
  feedback.classList.add("is-active");

  await api("/label", {
    method: "POST",
    body: JSON.stringify({
      id: currentEntry.id,
      human_label: label,
      labeler,
      labeled_at: formatLocalISO(new Date()),
    }),
  });

  setTimeout(async () => {
    await loadNextEntry();
    feedback.classList.remove("is-active");
  }, 300);
}

document.getElementById("label-yes").addEventListener("click", () => submitLabel("yes"));
document.getElementById("label-no").addEventListener("click", () => submitLabel("no"));

// Keyboard shortcuts while the Label tab is active: Y / Right = match, N / Left = no match.
document.addEventListener("keydown", (e) => {
  const labelPanelActive = document.getElementById("panel-label").classList.contains("is-active");
  if (!labelPanelActive || !currentEntry) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "y" || e.key === "Y" || e.key === "ArrowRight") submitLabel("yes");
  if (e.key === "n" || e.key === "N" || e.key === "ArrowLeft") submitLabel("no");
});

// ---------- EXPORT panel ----------
async function loadExportStats() {
  const { counts } = await api("/entries?status=all&limit=1");
  const el = document.getElementById("export-stats");
  const labeled = (counts.yes || 0) + (counts.no || 0);
  el.innerHTML = `
    <div><span class="n">${labeled}</span><span class="l">labeled</span></div>
    <div><span class="n">${counts.yes || 0}</span><span class="l">match (yes)</span></div>
    <div><span class="n">${counts.no || 0}</span><span class="l">no match</span></div>
    <div><span class="n">${counts.unlabeled || 0}</span><span class="l">unlabeled</span></div>
  `;
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("export-status");
  try {
    const res = await fetch("/api/export");
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Export failed");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mira_dataset_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = "Downloaded.";
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  }
});

// ---------- init ----------
loadItems();
