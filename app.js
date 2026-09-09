// ---------- session ----------
const toastRegion = document.getElementById("toast-region");

function showToast(message, tone = "") {
  if (!toastRegion) return;
  const toast = document.createElement("div");
  toast.className = `toast ${tone ? `is-${tone}` : ""}`;
  toast.textContent = message;
  toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px)";
    setTimeout(() => toast.remove(), 180);
  }, 2800);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) };
  let res;
  try {
    res = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store", ...opts, headers });
  } catch (error) {
    throw new Error("Network error — check your connection and try again.");
  }

  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (res.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Session expired — redirecting to sign in.");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setBusy(button, busy, text = "Working…") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) button.dataset.originalText = button.querySelector("span")?.textContent || button.textContent;
    button.disabled = true;
    const label = button.querySelector("span");
    if (label) label.textContent = text;
  } else {
    button.disabled = false;
    const label = button.querySelector("span");
    if (label && button.dataset.originalText) label.textContent = button.dataset.originalText;
  }
}

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-error", "is-success");
  if (tone) el.classList.add(`is-${tone}`);
}

// ---------- logout ----------
document.getElementById("logout-btn").addEventListener("click", async () => {
  const button = document.getElementById("logout-btn");
  button.disabled = true;
  try { await fetch("/api/logout", { method: "POST", credentials: "same-origin", cache: "no-store" }); } catch {}
  window.location.replace("/login.html");
});

// ---------- tab switching ----------
const tabIndicator = document.getElementById("tab-indicator");
function moveTabIndicator(btn) {
  if (!tabIndicator || !btn) return;
  const nav = btn.parentElement;
  const navRect = nav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  tabIndicator.style.width = `${btnRect.width}px`;
  tabIndicator.style.transform = `translateX(${btnRect.left - navRect.left}px)`;
}

async function activateTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const active = b === btn;
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
  document.getElementById(`panel-${name}`)?.classList.add("is-active");
  moveTabIndicator(btn);
  if (name === "label") await loadNextEntry();
  if (name === "export") await loadExportStats();
  if (name === "create") await loadItems();
}

document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => activateTab(btn.dataset.tab)));
window.addEventListener("resize", () => moveTabIndicator(document.querySelector(".tab-btn.is-active")));

// ---------- helpers ----------
function lowerFirst(s) {
  if (!s) return s;
  if (s === s.toUpperCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
function stripLeadingVerb(phrase) {
  return phrase.trim().replace(/^(i\s+(can|could|will|offer|teach|know)\s+)/i, "").trim();
}
function offerVariants(phrase) {
  const p = lowerFirst(stripLeadingVerb(phrase));
  const capped = p.charAt(0).toUpperCase() + p.slice(1);
  return [
    `I can offer ${p}.`, `I'm happy to help with ${p}.`, `I have experience with ${p} and can teach it.`,
    `I offer ${p} for anyone interested.`, `${capped} is something I can share with others.`,
    `I know ${p} well and can walk someone through it.`, `Count me in to help with ${p}.`,
    `I can put together a session on ${p}.`, `Happy to run a beginner-friendly session on ${p}.`,
  ];
}
function wantVariants(phrase) {
  const p = lowerFirst(stripLeadingVerb(phrase));
  return [
    `I want ${p}.`, `I'm looking for help with ${p}.`, `I need someone who can help me with ${p}.`,
    `I'd love to learn more about ${p}.`, `Looking for guidance on ${p}.`, `I need a hand with ${p}.`,
    `Could really use help with ${p}.`, `I'm hoping to find someone who can teach me ${p}.`,
    `Would appreciate any pointers on ${p}.`,
  ];
}
function randomIndexExcluding(length, exclude) {
  if (length <= 1) return 0;
  let idx;
  do idx = Math.floor(Math.random() * length); while (idx === exclude);
  return idx;
}
function formatLocalISO(d) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
}

// ---------- CREATE ----------
let offerIdx = 0;
let wantIdx = 0;
const phraseInput = document.getElementById("phrase-input");
const draftArea = document.getElementById("draft-area");

document.querySelectorAll(".suggestion-chip").forEach((button) => {
  button.addEventListener("click", () => {
    phraseInput.value = button.dataset.phrase || "";
    phraseInput.focus();
  });
});
document.getElementById("clear-phrase-btn").addEventListener("click", () => { phraseInput.value = ""; phraseInput.focus(); });
phraseInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); document.getElementById("draft-btn").click(); }
});

document.getElementById("draft-btn").addEventListener("click", () => {
  const phrase = phraseInput.value.trim();
  if (!phrase) { setStatus(document.getElementById("create-status"), "Add an activity first.", "error"); phraseInput.focus(); return; }
  const offers = offerVariants(phrase); const wants = wantVariants(phrase);
  offerIdx = Math.floor(Math.random() * offers.length); wantIdx = Math.floor(Math.random() * wants.length);
  document.getElementById("offer-text").value = offers[offerIdx];
  document.getElementById("want-text").value = wants[wantIdx];
  document.getElementById("offer-variant-count").textContent = `(${offerIdx + 1}/${offers.length})`;
  document.getElementById("want-variant-count").textContent = `(${wantIdx + 1}/${wants.length})`;
  draftArea.hidden = false; draftArea.dataset.phrase = phrase;
  setStatus(document.getElementById("create-status"), "Draft ready — edit freely before saving.", "success");
});

document.getElementById("cycle-offer").addEventListener("click", () => {
  const variants = offerVariants(draftArea.dataset.phrase || "");
  offerIdx = randomIndexExcluding(variants.length, offerIdx);
  document.getElementById("offer-text").value = variants[offerIdx];
  document.getElementById("offer-variant-count").textContent = `(${offerIdx + 1}/${variants.length})`;
});
document.getElementById("cycle-want").addEventListener("click", () => {
  const variants = wantVariants(draftArea.dataset.phrase || "");
  wantIdx = randomIndexExcluding(variants.length, wantIdx);
  document.getElementById("want-text").value = variants[wantIdx];
  document.getElementById("want-variant-count").textContent = `(${wantIdx + 1}/${variants.length})`;
});

document.getElementById("save-draft-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const phrase = draftArea.dataset.phrase || "";
  const items = [];
  if (document.getElementById("offer-include").checked) items.push({ text: document.getElementById("offer-text").value.trim(), type: "offer", source_phrase: phrase });
  if (document.getElementById("want-include").checked) items.push({ text: document.getElementById("want-text").value.trim(), type: "want", source_phrase: phrase });
  if (!items.length || items.some((item) => !item.text)) { setStatus(document.getElementById("create-status"), "Select at least one non-empty item.", "error"); return; }
  setBusy(button, true, "Saving…");
  try {
    await api("/items", { method: "POST", body: JSON.stringify({ items }) });
    setStatus(document.getElementById("create-status"), `Saved ${items.length} item${items.length > 1 ? "s" : ""} to the bank.`, "success");
    showToast("Item bank updated.", "success");
    phraseInput.value = ""; draftArea.hidden = true;
    await loadItems();
  } catch (error) {
    setStatus(document.getElementById("create-status"), `Error: ${error.message}`, "error");
    showToast(error.message, "error");
  } finally { setBusy(button, false); }
});

document.getElementById("refresh-items-btn").addEventListener("click", loadItems);

async function loadItems() {
  try {
    const { items } = await api("/items");
    const offers = items.filter((i) => i.type === "offer");
    const wants = items.filter((i) => i.type === "want");
    document.getElementById("offer-count").textContent = offers.length;
    document.getElementById("want-count").textContent = wants.length;
    document.getElementById("metric-offers").textContent = offers.length;
    document.getElementById("metric-wants").textContent = wants.length;
    const offerMeter = Math.min(100, offers.length * 5); const wantMeter = Math.min(100, wants.length * 5);
    document.getElementById("offer-meter-fill").style.width = `${offerMeter}%`;
    document.getElementById("want-meter-fill").style.width = `${wantMeter}%`;
    renderItemList("offer-list", offers);
    renderItemList("want-list", wants);
  } catch (error) { showToast(error.message, "error"); }
}
function renderItemList(elId, list) {
  const el = document.getElementById(elId); el.innerHTML = "";
  for (const item of list) {
    const li = document.createElement("li"); const span = document.createElement("span"); span.textContent = item.text;
    const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "remove"; btn.setAttribute("aria-label", `Remove ${item.text}`);
    btn.addEventListener("click", async () => {
      try { await api(`/items?id=${encodeURIComponent(item.id)}`, { method: "DELETE" }); showToast("Item removed."); await loadItems(); }
      catch (error) { showToast(error.message, "error"); }
    });
    li.append(span, btn); el.appendChild(li);
  }
}

// ---------- item bank backup / restore ----------
const backupDownloadBtn = document.getElementById("backup-download-btn");
const backupUploadInput = document.getElementById("backup-upload-input");
const backupStatus = document.getElementById("backup-status");

backupDownloadBtn?.addEventListener("click", async () => {
  setBusy(backupDownloadBtn, true, "Preparing…");
  try {
    const { items } = await api("/items");
    if (!items.length) {
      setStatus(backupStatus, "Your item bank is empty — nothing to back up yet.", "error");
      return;
    }
    const payload = {
      kind: "mira-item-bank-backup",
      version: 1,
      exported_at: new Date().toISOString(),
      count: items.length,
      items: items.map((item) => ({
        text: item.text,
        type: item.type,
        source_phrase: item.source_phrase || null,
        created_at: item.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = payload.exported_at.slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = url; link.download = `mira-item-bank-${stamp}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    setStatus(backupStatus, `Downloaded ${items.length} item${items.length === 1 ? "" : "s"} to a backup file.`, "success");
    showToast("Item bank backup downloaded.", "success");
  } catch (error) {
    setStatus(backupStatus, `Error: ${error.message}`, "error");
    showToast(error.message, "error");
  } finally { setBusy(backupDownloadBtn, false); }
});

backupUploadInput?.addEventListener("change", async () => {
  const file = backupUploadInput.files?.[0];
  backupUploadInput.value = ""; // allow re-selecting the same file again later
  if (!file) return;
  setStatus(backupStatus, "Reading backup file…");
  try {
    const raw = JSON.parse(await file.text());
    const incoming = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : null;
    if (!incoming) throw new Error("That file doesn't look like a Mira item bank backup.");

    const cleaned = incoming
      .map((item) => ({
        text: String(item?.text || "").trim(),
        type: item?.type === "offer" || item?.type === "want" ? item.type : null,
        source_phrase: item?.source_phrase || null,
        created_at: typeof item?.created_at === "string" ? item.created_at : null,
      }))
      .filter((item) => item.text && item.type);
    if (!cleaned.length) throw new Error("No valid offer/want items found in that file.");

    const { items: existing } = await api("/items");
    const existingKeys = new Set(existing.map((item) => `${item.type}::${item.text}`));
    const toRestore = cleaned.filter((item) => !existingKeys.has(`${item.type}::${item.text}`));
    const skipped = cleaned.length - toRestore.length;

    if (!toRestore.length) {
      setStatus(backupStatus, `Every item in that file (${cleaned.length}) is already in your bank — nothing to restore.`, "success");
      showToast("Bank already matches that backup.");
      return;
    }

    setStatus(backupStatus, `Restoring ${toRestore.length} item${toRestore.length === 1 ? "" : "s"}…`);
    await api("/items", { method: "POST", body: JSON.stringify({ items: toRestore }) });
    const skippedNote = skipped ? ` (${skipped} already in your bank were skipped)` : "";
    setStatus(backupStatus, `Restored ${toRestore.length} item${toRestore.length === 1 ? "" : "s"}${skippedNote}.`, "success");
    showToast("Item bank restored from file.", "success");
    await loadItems();
  } catch (error) {
    setStatus(backupStatus, `Error: ${error.message}`, "error");
    showToast(error.message, "error");
  }
});

// ---------- GENERATE ----------
const genCount = document.getElementById("gen-count");
document.querySelectorAll(".stepper-btn").forEach((button) => button.addEventListener("click", () => {
  const delta = Number(button.dataset.step) || 0;
  genCount.value = Math.min(1000, Math.max(1, (Number(genCount.value) || 30) + delta));
}));
document.querySelectorAll(".preset-btn").forEach((button) => button.addEventListener("click", () => {
  genCount.value = button.dataset.count;
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("is-active", b === button));
}));

document.getElementById("generate-btn").addEventListener("click", async (event) => {
  const count = Math.min(1000, Math.max(1, Number(genCount.value) || 30));
  const statusEl = document.getElementById("generate-status");
  const button = event.currentTarget; genCount.value = count;
  setStatus(statusEl, "Building a balanced queue…"); setBusy(button, true, "Generating…");
  try {
    const res = await api("/generate", { method: "POST", body: JSON.stringify({ count }) });
    setStatus(statusEl, res.exhausted ? `Generated ${res.generated} of ${res.requested} — the remaining unique combinations are running low.` : `Generated ${res.generated} new combinations.`, "success");
    document.getElementById("generated-total").textContent = res.generated;
    renderBucketGrid(res.bucketCounts);
    document.getElementById("metric-unlabeled").textContent = "…";
    showToast(`${res.generated} combinations added.`, "success");
  } catch (error) {
    setStatus(statusEl, `Error: ${error.message}`, "error"); showToast(error.message, "error");
  } finally { setBusy(button, false); }
});

function renderBucketGrid(counts = {}) {
  const el = document.getElementById("bucket-grid"); el.innerHTML = "";
  const values = [];
  for (let o = 1; o <= 3; o++) for (let w = 1; w <= 3; w++) values.push(Number(counts[`${o}x${w}`] || 0));
  const max = Math.max(1, ...values);
  for (let o = 1; o <= 3; o++) for (let w = 1; w <= 3; w++) {
    const key = `${o}x${w}`; const n = Number(counts[key] || 0);
    const cell = document.createElement("div"); cell.className = "bucket-cell";
    if (n === max && n > 0) cell.classList.add("is-max");
    const bar = document.createElement("div"); bar.className = "bar"; bar.style.height = `${(n / max) * 100}%`;
    const num = document.createElement("span"); num.className = "n"; num.textContent = n;
    const label = document.createElement("span"); label.className = "bucket-label"; label.textContent = `${o} offer${o > 1 ? "s" : ""} × ${w} want${w > 1 ? "s" : ""}`;
    cell.append(bar, num, label); el.appendChild(cell);
  }
}
renderBucketGrid();

// ---------- LABEL ----------
const HIGHLIGHT_COLORS = ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#ddd6fe", "#fed7aa"];
const labelerInput = document.getElementById("labeler-name");
labelerInput.value = localStorage.getItem("mira_labeler_name") || "";
labelerInput.addEventListener("input", () => localStorage.setItem("mira_labeler_name", labelerInput.value));
let currentEntry = null;
let labelingBusy = false;

async function loadNextEntry() {
  try {
    const { entries, counts } = await api("/entries?status=unlabeled&limit=1");
    const total = Number(counts.total || 0); const unlabeled = Number(counts.unlabeled || 0); const done = total - unlabeled;
    document.getElementById("label-progress").textContent = `${unlabeled} unlabeled · ${total} total`;
    document.getElementById("progress-fill").style.width = total ? `${(done / total) * 100}%` : "0%";
    document.getElementById("metric-unlabeled").textContent = unlabeled;
    if (!entries.length) {
      currentEntry = null; document.getElementById("label-card").hidden = true; document.getElementById("label-empty").hidden = false; return;
    }
    document.getElementById("label-empty").hidden = true;
    const card = document.getElementById("label-card"); card.hidden = false; card.classList.add("is-loading"); currentEntry = entries[0];
    document.getElementById("entry-index-label").textContent = `Entry #${currentEntry.id}`;
    await renderEntry(currentEntry);
    requestAnimationFrame(() => card.classList.remove("is-loading"));
  } catch (error) { showToast(error.message, "error"); }
}
function tokenize(text) {
  const stop = new Set(["i","a","an","the","to","for","with","and","of","on","in","my","me","want","need","can","help","someone","who","looking"]);
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)))];
}
function highlightSharedTerms(texts) {
  const tokensByItem = texts.map(tokenize); const tokenItems = {};
  tokensByItem.forEach((toks, idx) => toks.forEach((t) => (tokenItems[t] = tokenItems[t] || new Set()).add(idx)));
  const sharedTokens = Object.keys(tokenItems).filter((t) => tokenItems[t].size > 1); const colorFor = {};
  sharedTokens.forEach((t, i) => (colorFor[t] = HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]));
  return texts.map((text) => {
    const escaped = text.replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
    if (!sharedTokens.length) return escaped;
    const pattern = new RegExp(`\\b(${sharedTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    return escaped.replace(pattern, (m) => `<mark style="background:${colorFor[m.toLowerCase()]}">${m}</mark>`);
  });
}
async function renderEntry(entry) {
  const offerHtml = highlightSharedTerms(entry.offers); const wantHtml = highlightSharedTerms(entry.wants);
  const translate = document.getElementById("translate-toggle").checked;
  let translations = {};
  if (translate) {
    const texts = [...new Set([...entry.offers, ...entry.wants])];
    const res = await api("/translate", { method: "POST", body: JSON.stringify({ texts }) }); translations = res.translations || {};
  }
  document.getElementById("entry-offers").innerHTML = entry.offers.map((text, i) => `<div class="entry-item"><div class="en">${offerHtml[i]}</div>${translate && translations[text] ? `<div class="zh">${escapeHtml(translations[text])}</div>` : ""}</div>`).join("");
  document.getElementById("entry-wants").innerHTML = entry.wants.map((text, i) => `<div class="entry-item"><div class="en">${wantHtml[i]}</div>${translate && translations[text] ? `<div class="zh">${escapeHtml(translations[text])}</div>` : ""}</div>`).join("");
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
document.getElementById("translate-toggle").addEventListener("change", () => currentEntry && renderEntry(currentEntry).catch((error) => showToast(error.message, "error")));

async function labelCurrent(humanLabel) {
  if (!currentEntry || labelingBusy) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { setStatus(document.getElementById("label-progress"), "", ""); labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  labelingBusy = true;
  const yes = humanLabel === "yes"; const feedback = document.getElementById("label-feedback");
  document.getElementById("feedback-yes-icon").hidden = !yes; document.getElementById("feedback-no-icon").hidden = yes;
  feedback.classList.add("is-active");
  try {
    await api("/label", { method: "POST", body: JSON.stringify({ id: currentEntry.id, human_label: humanLabel, labeler, labeled_at: formatLocalISO(new Date()) }) });
    await new Promise((resolve) => setTimeout(resolve, 150));
    feedback.classList.remove("is-active");
    await loadNextEntry();
  } catch (error) {
    feedback.classList.remove("is-active"); showToast(error.message, "error");
  } finally { labelingBusy = false; }
}
document.getElementById("label-no").addEventListener("click", () => labelCurrent("no"));
document.getElementById("label-yes").addEventListener("click", () => labelCurrent("yes"));
document.addEventListener("keydown", (event) => {
  if (!document.getElementById("panel-label").classList.contains("is-active") || labelingBusy) return;
  const tag = document.activeElement?.tagName;
  if (["INPUT","TEXTAREA","BUTTON","SELECT"].includes(tag)) return;
  if (event.key.toLowerCase() === "y" || event.key === "ArrowRight") labelCurrent("yes");
  if (event.key.toLowerCase() === "n" || event.key === "ArrowLeft") labelCurrent("no");
});

// ---------- EXPORT ----------
async function loadExportStats() {
  try {
    const { counts } = await api("/entries?status=all&limit=1");
    document.getElementById("export-stats").innerHTML = `
      <div><span class="n">${Number(counts.total || 0)}</span><span class="l">total</span></div>
      <div><span class="n">${Number(counts.yes || 0)}</span><span class="l">matches</span></div>
      <div><span class="n">${Number(counts.no || 0)}</span><span class="l">no match</span></div>`;
  } catch (error) { showToast(error.message, "error"); }
}

document.getElementById("export-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget; const status = document.getElementById("export-status"); setBusy(button, true, "Preparing…"); setStatus(status, "Preparing JSON export…");
  try {
    const res = await fetch("/api/export", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { window.location.replace("/login.html"); return; }
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Export failed (${res.status})`); }
    const blob = await res.blob(); const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/); const filename = match?.[1] || `mira_dataset_${new Date().toISOString().slice(0,10)}.json`;
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setStatus(status, `Downloaded ${filename}.`, "success"); showToast("Dataset export downloaded.", "success");
  } catch (error) { setStatus(status, error.message, "error"); showToast(error.message, "error"); }
  finally { setBusy(button, false); }
});

// ---------- Mira Muse: local idea helper ----------
const helperInput = document.getElementById("helper-input");
const helperResults = document.getElementById("helper-results");
const helperStatus = document.getElementById("helper-status");
const helperGo = document.getElementById("helper-go-btn");
let helperMode = "rephrase";

const helperFieldSets = [
  { test: /baseball|softball|pitch|bat|training|sports/i, ideas: ["I want to find a baseball training partner to practice with.", "I'm looking for someone to train with and improve my baseball skills.", "I'd love to connect with a player who wants to practice together."] },
  { test: /math|algebra|calculus|science|chemistry|physics|biology/i, ideas: ["I'm looking for someone to study and work through problems with.", "I want help understanding the topic through practice and examples.", "I'd like to find a study partner who can explain the tricky parts clearly."] },
  { test: /music|guitar|piano|sing|instrument|band/i, ideas: ["I'm looking for someone to practice music with and swap tips.", "I'd love to learn from someone who enjoys making music together.", "I want to find a practice partner with similar musical interests."] },
  { test: /art|draw|paint|design|photo|photography|video/i, ideas: ["I'd like to collaborate with someone on creative projects and improve my skills.", "I'm looking for feedback and ideas from someone interested in visual creativity.", "I want to find a creative partner to practice and make projects with."] },
  { test: /language|spanish|french|chinese|japanese|korean|english/i, ideas: ["I'm looking for a conversation partner to practice a language with.", "I'd like to trade language practice with someone at a similar level.", "I want to build confidence speaking through casual practice."] },
  { test: /cook|bake|food|recipe|chef|cooking/i, ideas: ["I'd love to learn new cooking techniques from someone who enjoys sharing them.", "I'm looking for a cooking partner to try recipes and swap ideas.", "I want to practice cooking together and learn from each other."] },
  { test: /travel|trip|hike|camp|outdoor/i, ideas: ["I'm looking for someone to plan an adventure and explore together.", "I'd love to find a travel buddy with similar interests and pace.", "I want to connect with someone who enjoys exploring new places."] },
];

function normalizeHelperText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function sentenceCase(value) { const t = normalizeHelperText(value); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
function helperBaseIdeas(text) {
  const topic = normalizeHelperText(text).replace(/[.!?]+$/, "");
  const match = helperFieldSets.find((item) => item.test.test(topic));
  if (match) return match.ideas;
  const p = topic || "a new skill";
  return [
    `I'm looking for someone to learn more about ${p} with.`,
    `I'd love to connect with someone who is interested in ${p}.`,
    `I want to explore ${p} with a person who can share ideas and practice together.`,
  ];
}
function finishIdeas(text) {
  const base = sentenceCase(text).replace(/[.!?]+$/, "");
  if (!base) return helperBaseIdeas("a new skill");
  const lower = base.toLowerCase();
  const endings = lower.startsWith("i want")
    ? [" so I can practice and improve.", " and meet someone who is interested too.", " with someone at a similar level."]
    : lower.startsWith("i can") || lower.startsWith("i offer")
      ? [" for someone who wants to learn and practice.", " and tailor it to a beginner-friendly level.", " while keeping it practical and easy to follow."]
      : [" and turn it into something practical.", " with someone who can share ideas and feedback.", " in a relaxed, beginner-friendly way."];
  return endings.map((end) => `${base}${end}`);
}
function rephraseIdeas(text) {
  const topic = normalizeHelperText(text).replace(/[.!?]+$/, "");
  if (!topic) return helperBaseIdeas("a new skill");
  const generic = helperBaseIdeas(topic);
  const p = topic.replace(/^(i\s+(want|need|would like|am looking for|can|offer)\s+)/i, "").trim();
  return [
    `I'd like to ${/^(want|need)/i.test(topic) ? "find help with" : "explore"} ${p}.`,
    `I'm looking for a chance to learn, practice, or share ${p}.`,
    generic[2] || `I'd love to connect with someone interested in ${p}.`,
  ];
}
function renderHelperIdeas(ideas) {
  helperResults.innerHTML = ideas.map((idea, index) => `
    <article class="helper-card" style="animation-delay:${index * 55}ms">
      <span class="helper-card-tag">Idea ${index + 1}</span>
      <p>${escapeHtml(idea)}</p>
      <div class="helper-card-actions">
        <button type="button" class="helper-use" data-helper-idea="${escapeHtml(idea)}">Use in draft</button>
        <button type="button" class="helper-copy" data-helper-copy="${escapeHtml(idea)}">Copy</button>
      </div>
    </article>`).join("");
  helperResults.querySelectorAll("[data-helper-idea]").forEach((btn) => btn.addEventListener("click", () => {
    const idea = btn.getAttribute("data-helper-idea") || "";
    const target = document.getElementById("want-text");
    target.value = idea;
    draftArea.hidden = false;
    if (!draftArea.dataset.phrase) draftArea.dataset.phrase = helperInput.value.trim();
    setStatus(document.getElementById("create-status"), "Idea placed in the Want draft — edit it freely.", "success");
    target.focus();
    showToast("Added to your Want draft.", "success");
  }));
  helperResults.querySelectorAll("[data-helper-copy]").forEach((btn) => btn.addEventListener("click", async () => {
    const text = btn.getAttribute("data-helper-copy") || "";
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; setTimeout(() => btn.textContent = "Copy", 900); }
    catch { showToast("Could not copy that idea.", "error"); }
  }));
}
function runHelper() {
  const text = normalizeHelperText(helperInput.value);
  if (!text) {
    helperStatus.textContent = "Give me a little spark";
    helperInput.focus();
    showToast("Type a topic or partly written phrase first.", "error");
    return;
  }
  let ideas = helperMode === "finish" ? finishIdeas(text) : helperMode === "brainstorm" ? helperBaseIdeas(text).concat([`Try narrowing ${text} into a skill, goal, person to meet, or activity.`]) : rephraseIdeas(text);
  ideas = [...new Set(ideas)].slice(0, 4);
  helperStatus.textContent = `${ideas.length} ideas ready`;
  renderHelperIdeas(ideas);
}
document.querySelectorAll(".helper-mode").forEach((button) => button.addEventListener("click", () => {
  helperMode = button.dataset.helperMode || "rephrase";
  document.querySelectorAll(".helper-mode").forEach((b) => b.classList.toggle("is-active", b === button));
  helperStatus.textContent = helperMode === "rephrase" ? "Polish the thought" : helperMode === "finish" ? "Complete the thought" : "Make it bigger";
  if (normalizeHelperText(helperInput.value)) runHelper();
}));
helperGo.addEventListener("click", runHelper);
helperInput.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); runHelper(); } });
document.querySelectorAll(".helper-quick").forEach((button) => button.addEventListener("click", () => {
  const source = button.dataset.helperSource;
  helperInput.value = source === "offer" ? document.getElementById("offer-text").value : source === "want" ? document.getElementById("want-text").value : phraseInput.value;
  helperInput.focus();
  helperStatus.textContent = "Nice — I can work from that";
  runHelper();
}));

// ---------- file import: activity/topic list -> reviewable wants/offers ----------
const activityFileInput = document.getElementById("activity-file-input");
const importDrop = document.getElementById("import-drop");
const importPreview = document.getElementById("import-preview");

function cleanImportedLine(value) {
  return normalizeHelperText(String(value || "")
    .replace(/^\s*(?:[-*•·▪◦‣]|\d+[.)]|\[[ xX]\])\s*/, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s*[,;|]\s*$/, ""));
}

function parseCsvLines(text) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { cells.push(cell.trim()); cell = ""; continue; }
      cell += ch;
    }
    cells.push(cell.trim());
    rows.push(cells.filter(Boolean));
  }
  return rows;
}

function extractStringsFromJson(value, output = []) {
  if (typeof value === "string") {
    const v = cleanImportedLine(value);
    if (v) output.push(v);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => extractStringsFromJson(item, output));
    return output;
  }
  if (value && typeof value === "object") {
    const preferredKeys = ["activity", "activities", "subject", "subjects", "topic", "topics", "skill", "skills", "name", "title", "text", "item"];
    const seen = new Set();
    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        extractStringsFromJson(value[key], output);
        seen.add(key);
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      if (!seen.has(key)) extractStringsFromJson(nested, output);
    }
  }
  return output;
}

function extractImportedTopics(filename, text) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  let topics = [];
  if (ext === "json") {
    try { topics = extractStringsFromJson(JSON.parse(text)); }
    catch { topics = String(text).split(/\r?\n/).map(cleanImportedLine); }
  } else if (ext === "csv") {
    const rows = parseCsvLines(text);
    const headers = (rows[0] || []).map((h) => h.toLowerCase());
    const preferred = headers.findIndex((h) => /activity|subject|topic|skill|name|title|interest/.test(h));
    topics = rows.slice(preferred >= 0 ? 1 : 0).map((row) => cleanImportedLine(row[preferred >= 0 ? preferred : 0] || row.find(Boolean)));
  } else {
    topics = String(text).split(/\r?\n|;/).map(cleanImportedLine);
  }
  const blocked = new Set(["activity", "activities", "subject", "subjects", "topic", "topics", "skill", "skills", "name", "title", "item", "items"]);
  return [...new Set(topics.map((topic) => normalizeHelperText(topic)).filter((topic) => topic.length >= 2 && topic.length <= 180 && !blocked.has(topic.toLowerCase())))].slice(0, 60);
}

function importedWant(topic) {
  const t = topic.replace(/[.!?]+$/, "");
  if (/^(i\s+want|i\'d\s+like|looking\s+for|need|i\s+am\s+looking)/i.test(t)) return sentenceCase(t) + (/[.!?]$/.test(t) ? "" : ".");
  return `I want to explore ${lowerFirst(t)}.`;
}
function importedOffer(topic) {
  const t = topic.replace(/[.!?]+$/, "");
  if (/^(i\s+can|i\s+offer|happy\s+to|i\s+teach)/i.test(t)) return sentenceCase(t) + (/[.!?]$/.test(t) ? "" : ".");
  return `I can help with ${lowerFirst(t)}.`;
}

function importedCandidates(topics) {
  return topics.flatMap((topic, index) => [
    { id: `${index}-want`, type: "want", text: importedWant(topic), source: topic },
    { id: `${index}-offer`, type: "offer", text: importedOffer(topic), source: topic },
  ]);
}

function renderImportPreview(filename, topics) {
  if (!topics.length) {
    importPreview.hidden = false;
    importPreview.innerHTML = `<div class="import-empty">I couldn't find any usable activity or subject lines in <strong>${escapeHtml(filename)}</strong>. Try a TXT/MD list, a simple CSV column, or a JSON array of topics.</div>`;
    return;
  }
  const candidates = importedCandidates(topics);
  importPreview.hidden = false;
  importPreview.innerHTML = `
    <div class="import-preview-head">
      <div><div class="import-preview-title">${escapeHtml(filename)}</div><div class="import-preview-meta">${topics.length} topics · ${candidates.length} draft ideas</div></div>
      <button type="button" class="btn-text" id="import-clear-btn">clear</button>
    </div>
    <div class="import-candidate-list" id="import-candidate-list">
      ${candidates.map((candidate) => `
        <label class="import-candidate" data-candidate-id="${candidate.id}">
          <input class="import-check" type="checkbox" checked data-import-check="${candidate.id}" />
          <span>
            <span class="import-candidate-text" data-import-text="${candidate.id}">${escapeHtml(candidate.text)}</span>
            <span class="import-candidate-source">from: ${escapeHtml(candidate.source)}</span>
          </span>
          <span class="import-type-toggle" role="group" aria-label="Choose type">
            <button type="button" class="is-active ${candidate.type}" data-import-type="${candidate.id}" data-type="${candidate.type}">${candidate.type === "want" ? "Want" : "Offer"}</button>
            <button type="button" data-import-type="${candidate.id}" data-type="${candidate.type === "want" ? "offer" : "want"}">${candidate.type === "want" ? "Offer" : "Want"}</button>
          </span>
        </label>`).join("")}
    </div>
    <div class="import-save-row">
      <button type="button" class="btn btn-secondary" id="import-select-all-btn">Select all</button>
      <button type="button" class="btn btn-primary" id="import-save-btn"><span>Add selected to bank</span><span class="btn-arrow">↓</span></button>
    </div>`;

  document.getElementById("import-clear-btn").addEventListener("click", () => {
    importPreview.hidden = true;
    importPreview.innerHTML = "";
    activityFileInput.value = "";
  });
  document.getElementById("import-select-all-btn").addEventListener("click", (event) => {
    const checks = [...importPreview.querySelectorAll(".import-check")];
    const allChecked = checks.every((check) => check.checked);
    checks.forEach((check) => { check.checked = !allChecked; });
    event.currentTarget.textContent = allChecked ? "Select all" : "Clear all";
  });
  importPreview.querySelectorAll("[data-import-type]").forEach((button) => button.addEventListener("click", (event) => {
    event.preventDefault();
    const group = button.closest(".import-type-toggle");
    group.querySelectorAll("button").forEach((b) => b.classList.remove("is-active", "want", "offer"));
    button.classList.add("is-active", button.dataset.type);
    const id = button.dataset.importType;
    const textEl = importPreview.querySelector(`[data-import-text="${CSS.escape(id)}"]`);
    const source = importPreview.querySelector(`[data-candidate-id="${CSS.escape(id)}"] .import-candidate-source`)?.textContent.replace(/^from:\s*/i, "") || "";
    if (textEl) textEl.textContent = button.dataset.type === "want" ? importedWant(source) : importedOffer(source);
  }));
  document.getElementById("import-save-btn").addEventListener("click", saveImportedCandidates);
}

async function saveImportedCandidates(event) {
  const button = event.currentTarget;
  const items = [];
  importPreview.querySelectorAll(".import-candidate").forEach((row) => {
    const check = row.querySelector(".import-check");
    const activeType = row.querySelector(".import-type-toggle .is-active");
    const text = row.querySelector(".import-candidate-text")?.textContent.trim();
    const source = row.querySelector(".import-candidate-source")?.textContent.replace(/^from:\s*/i, "").trim();
    if (check?.checked && activeType && text) items.push({ text, type: activeType.dataset.type, source_phrase: source || null });
  });
  if (!items.length) { showToast("Select at least one idea to import.", "error"); return; }
  setBusy(button, true, "Adding…");
  try {
    await api("/items", { method: "POST", body: JSON.stringify({ items }) });
    showToast(`${items.length} imported item${items.length === 1 ? "" : "s"} added to the bank.`, "success");
    setStatus(document.getElementById("create-status"), `Added ${items.length} reviewed ideas from the uploaded list.`, "success");
    importPreview.hidden = true;
    importPreview.innerHTML = "";
    activityFileInput.value = "";
    await loadItems();
  } catch (error) {
    showToast(error.message, "error");
  } finally { setBusy(button, false); }
}

async function handleActivityFile(file) {
  if (!file) return;
  const allowed = /\.(txt|md|csv|json)$/i.test(file.name);
  if (!allowed) {
    importPreview.hidden = false;
    importPreview.innerHTML = `<div class="import-error">That file type isn't supported yet. Use a TXT, MD, CSV, or JSON activity/subject list.</div>`;
    return;
  }
  try {
    const text = await file.text();
    const topics = extractImportedTopics(file.name, text);
    renderImportPreview(file.name, topics);
    if (topics.length) showToast(`Found ${topics.length} usable topics.`, "success");
  } catch (error) {
    importPreview.hidden = false;
    importPreview.innerHTML = `<div class="import-error">I couldn't read that file. Try saving the list as TXT, CSV, MD, or JSON.</div>`;
  }
}

activityFileInput?.addEventListener("change", () => handleActivityFile(activityFileInput.files?.[0]));
["dragenter", "dragover"].forEach((type) => importDrop?.addEventListener(type, (event) => {
  event.preventDefault(); importDrop.classList.add("is-dragging");
}));
["dragleave", "drop"].forEach((type) => importDrop?.addEventListener(type, (event) => {
  event.preventDefault(); importDrop.classList.remove("is-dragging");
}));
importDrop?.addEventListener("drop", (event) => handleActivityFile(event.dataTransfer?.files?.[0]));

// ---------- gentle interactivity ----------
document.querySelectorAll(".btn, .suggestion-chip, .preset-btn, .icon-btn").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    const rect = button.getBoundingClientRect(); const ripple = document.createElement("span");
    const size = Math.max(rect.width, rect.height); ripple.style.cssText = `position:absolute;left:${event.clientX-rect.left-size/2}px;top:${event.clientY-rect.top-size/2}px;width:${size}px;height:${size}px;border-radius:50%;background:rgba(255,255,255,.18);transform:scale(0);pointer-events:none;animation:ripple .42s ease-out;`;
    button.appendChild(ripple); setTimeout(() => ripple.remove(), 450);
  });
});
const rippleStyle = document.createElement("style"); rippleStyle.textContent = "@keyframes ripple { to { transform: scale(1); opacity: 0; } }"; document.head.appendChild(rippleStyle);

// ---------- spark mascot micro-interactions (visual only) ----------
(function () {
  const sparkBtn = document.getElementById("mascot-spark");
  if (!sparkBtn) return;
  const helperStatusEl = document.getElementById("helper-status");
  function pulse() {
    sparkBtn.classList.remove("is-spinning");
    void sparkBtn.offsetWidth; // restart animation
    sparkBtn.classList.add("is-spinning");
  }
  sparkBtn.addEventListener("animationend", () => sparkBtn.classList.remove("is-spinning"));
  sparkBtn.addEventListener("click", () => {
    pulse();
    if (helperGoBtn) helperGoBtn.click();
    else helperInput?.focus();
  });
  if (helperStatusEl && "MutationObserver" in window) {
    new MutationObserver(pulse).observe(helperStatusEl, { childList: true, characterData: true, subtree: true });
  }
})();

// ---------- bootstrap ----------
(async function bootstrap() {
  moveTabIndicator(document.querySelector(".tab-btn.is-active"));
  await loadItems();
  await loadNextEntry();
})();
