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
    const pair = items.length === 2 && items.some((item) => item.type === "offer") && items.some((item) => item.type === "want")
      ? { owner: getCreateMissionOwner(), offer_text: items.find((item) => item.type === "offer")?.text || "", want_text: items.find((item) => item.type === "want")?.text || "" }
      : null;
    await api("/items", { method: "POST", body: JSON.stringify({ items, ...(pair ? { creator_pair: pair } : {}) }) });
    setStatus(document.getElementById("create-status"), `Saved ${items.length} item${items.length > 1 ? "s" : ""} to the bank.`, "success");
    showToast("Item bank updated.", "success");
    phraseInput.value = ""; draftArea.hidden = true;
    await loadItems();
    await refreshCreateMission();
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
    await refreshMission();
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

// ---------- CREATION MISSION ----------
const CREATE_MISSION_KEY = "mira_creation_mission_v1";
let createMission = JSON.parse(localStorage.getItem(CREATE_MISSION_KEY) || "null") || {
  goal: 25, flag: "✦", active: false, started_at: null, starting_pairs: 0, owner: "default"
};
let createMissionPresets = [];

function saveCreateMissionLocal() { localStorage.setItem(CREATE_MISSION_KEY, JSON.stringify(createMission)); }
function getCreateMissionOwner() { return document.getElementById("labeler-name")?.value.trim() || "default"; }
function createMissionPercent(pairs) { return Math.min(100, Math.max(0, (pairs / Math.max(1, createMission.goal)) * 100)); }
function setCreateMissionFlag(flag) {
  createMission.flag = flag || "✦";
  saveCreateMissionLocal();
  document.getElementById("create-mission-flag-cloth").textContent = createMission.flag;
  document.querySelectorAll(".create-mission-flag-choice").forEach((b) => b.classList.toggle("is-active", b.dataset.flag === createMission.flag));
}
function renderCreateMissionPresets() {
  const el = document.getElementById("create-mission-preset-list");
  if (!createMissionPresets.length) { el.innerHTML = `<span class="mission-empty-inline">No presets yet — save a goal you like.</span>`; return; }
  el.innerHTML = createMissionPresets.map((p) => `<div class="mission-preset"><button class="mission-preset-load" type="button" data-create-preset-id="${p.id}">${escapeHtml(p.flag)} ${escapeHtml(p.name)} · ${p.goal}</button><button class="mission-preset-delete" type="button" aria-label="Delete ${escapeHtml(p.name)}" data-delete-create-preset-id="${p.id}">×</button></div>`).join("");
}
function renderCreateMissionHistory(history) {
  const el = document.getElementById("create-mission-history-list");
  if (!history?.length) { el.innerHTML = `<div class="mission-history-empty">No completed missions yet.</div>`; return; }
  el.innerHTML = history.slice(0, 20).map((h) => {
    const date = new Date(h.completed_at).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
    const time = new Date(h.completed_at).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
    return `<div class="mission-history-item"><span class="mission-history-flag">${escapeHtml(h.flag || "✦")}</span><div class="mission-history-copy"><strong>${Number(h.pairs_total || h.goal)} pairs · goal ${Number(h.goal)}</strong><span>${date} · ${time}</span></div><span class="mission-history-total">${Number(h.pairs_total || 0)} new</span></div>`;
  }).join("");
}
function renderPairThemeList(id, themes) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!themes?.length) { el.innerHTML = '<div class="theme-empty">No pairs yet.</div>'; return; }
  el.innerHTML = themes.map((t) => `<div class="theme-row"><div class="theme-row-copy"><div class="theme-row-label"><strong>${escapeHtml(t.theme)}</strong><span>${Number(t.count)} pairs</span></div><div class="theme-bar"><i style="width:${Math.min(100, Number(t.share || 0))}%"></i></div></div><span>${Number(t.share || 0)}%</span></div>`).join('');
}
function renderPairQuality(quality) {
  const q = quality || {};
  document.getElementById('quality-duplicate-rate').textContent = `${Number(q.duplicate_rate || 0).toFixed(Number(q.duplicate_rate || 0) % 1 ? 1 : 0)}%`;
  document.getElementById('quality-duplicate-detail').textContent = `${Number(q.duplicates || 0)} duplicate attempt${Number(q.duplicates || 0) === 1 ? '' : 's'}`;
  document.getElementById('quality-average-length').textContent = `${Number(q.average_pair_words || 0)} words`;
  document.getElementById('quality-unique-pairs').textContent = Number(q.unique_pairs || 0).toLocaleString();
  document.getElementById('quality-attempt-detail').textContent = `${Number(q.attempts || 0).toLocaleString()} save attempt${Number(q.attempts || 0) === 1 ? '' : 's'}`;
  renderPairThemeList('offer-theme-list', q.offer_themes);
  renderPairThemeList('want-theme-list', q.want_themes);
}

function updateCreateMission(pairTotal, history = null) {
  const goal = Math.max(1, Number(createMission.goal) || 25);
  const owner = getCreateMissionOwner();
  const pairs = createMission.active && createMission.owner === owner ? Math.max(0, Number(pairTotal) - Number(createMission.starting_pairs || 0)) : 0;
  const shown = Math.min(goal, pairs);
  const pct = createMissionPercent(shown);
  document.getElementById("create-mission-goal").value = goal;
  document.getElementById("create-mission-title").textContent = `Write ${goal} new pairs.`;
  document.getElementById("create-mission-progress-text").textContent = `${shown} / ${goal} pairs written`;
  document.getElementById("create-mission-remaining-text").textContent = `${Math.max(0, goal - shown)} to go`;
  document.getElementById("create-mission-progress-fill").style.width = `${pct}%`;
  document.getElementById("create-mission-node-write").classList.toggle("is-done", createMission.active && shown > 0);
  document.getElementById("create-mission-node-write").classList.toggle("is-active", !createMission.active);
  document.getElementById("create-mission-node-pair").classList.toggle("is-active", createMission.active && shown < goal);
  document.getElementById("create-mission-node-pair").classList.toggle("is-done", createMission.active && shown >= goal);
  document.getElementById("create-mission-node-goal").classList.toggle("is-active", shown >= goal);
  document.getElementById("create-mission-node-goal").classList.toggle("is-done", shown >= goal);
  document.getElementById("create-mission-line-one").style.width = `${createMission.active ? Math.min(100, pct) : 0}%`;
  document.getElementById("create-mission-line-two").style.width = `${shown >= goal ? 100 : 0}%`;
  const status = document.getElementById("create-mission-status");
  status.textContent = shown >= goal ? "Complete" : createMission.active ? "In progress" : "Ready";
  status.classList.toggle("is-complete", shown >= goal);
  if (history) renderCreateMissionHistory(history);
}

async function refreshCreateMission() {
  try {
    const owner = getCreateMissionOwner();
    const data = await api(`/creator-missions?owner=${encodeURIComponent(owner)}`);
    createMissionPresets = data.presets || [];
    renderCreateMissionPresets();
    renderPairQuality(data.quality);
    const total = Number(data.pairTotal || 0);
    if (createMission.owner !== owner) {
      createMission.active = false; createMission.started_at = null; createMission.starting_pairs = total; createMission.owner = owner; saveCreateMissionLocal();
    }
    if (createMission.active && total - Number(createMission.starting_pairs || 0) >= Number(createMission.goal || 25)) {
      const result = await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"complete", owner, goal:createMission.goal, flag:createMission.flag, started_at:createMission.started_at, starting_pairs:createMission.starting_pairs }) });
      createMission.active = false; createMission.started_at = null; createMission.starting_pairs = total; saveCreateMissionLocal();
      showToast(`Creation mission complete — ${result.pairs_total} new pairs logged.`, "success");
      const refreshed = await api(`/creator-missions?owner=${encodeURIComponent(owner)}`);
      renderCreateMissionHistory(refreshed.history || []);
    } else renderCreateMissionHistory(data.history || []);
    updateCreateMission(total);
  } catch (error) { showToast(error.message, "error"); }
}

document.getElementById("create-mission-goal").addEventListener("change", () => {
  const value = Math.max(1, Math.min(10000, Number(document.getElementById("create-mission-goal").value) || 25));
  createMission.goal = value; saveCreateMissionLocal(); refreshCreateMission();
});
document.querySelectorAll(".create-mission-flag-choice").forEach((button) => button.addEventListener("click", () => setCreateMissionFlag(button.dataset.flag)));
document.getElementById("create-mission-run-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const owner = getCreateMissionOwner();
  const goal = Math.max(1, Math.min(10000, Number(document.getElementById("create-mission-goal").value) || 25));
  createMission.goal = goal;
  setBusy(button, true, "Launching…");
  try {
    const data = await api(`/creator-missions?owner=${encodeURIComponent(owner)}`);
    const total = Number(data.pairTotal || 0);
    if (!createMission.active || createMission.owner !== owner) {
      const started = await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"start", owner, goal, flag:createMission.flag }) });
      createMission.active = true; createMission.owner = owner; createMission.started_at = started.mission.started_at; createMission.starting_pairs = Number(started.mission.starting_pairs || total); saveCreateMissionLocal();
    }
    updateCreateMission(total, data.history || []);
    await activateTab("create");
    document.getElementById("phrase-input")?.focus();
    showToast(`Creation mission started — write ${goal} distinct pairs.`, "success");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
});
document.getElementById("create-mission-save-preset-btn").addEventListener("click", async () => {
  const goal = Math.max(1, Math.min(10000, Number(document.getElementById("create-mission-goal").value) || 25));
  const name = prompt("Name this creation mission preset:", `Create · ${goal}`);
  if (!name?.trim()) return;
  try { await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"preset", owner:getCreateMissionOwner(), name:name.trim(), goal, flag:createMission.flag }) }); await refreshCreateMission(); showToast("Creation mission preset saved.", "success"); }
  catch (error) { showToast(error.message, "error"); }
});
document.getElementById("create-mission-preset-list").addEventListener("click", async (event) => {
  const load = event.target.closest("[data-create-preset-id]");
  const del = event.target.closest("[data-delete-create-preset-id]");
  if (load) { const preset = createMissionPresets.find((p) => String(p.id) === load.dataset.createPresetId); if (preset) { createMission.goal = Number(preset.goal); createMission.owner = getCreateMissionOwner(); setCreateMissionFlag(preset.flag); saveCreateMissionLocal(); document.getElementById("create-mission-goal").value = createMission.goal; refreshCreateMission(); showToast(`${preset.name} loaded.`); } }
  if (del) { if (!confirm("Delete this creation mission preset?")) return; try { await api("/creator-missions", { method:"POST", body:JSON.stringify({ action:"delete_preset", owner:getCreateMissionOwner(), id:Number(del.dataset.deleteCreatePresetId) }) }); await refreshCreateMission(); } catch(error) { showToast(error.message,"error"); } }
});
document.getElementById("create-mission-refresh-history-btn").addEventListener("click", refreshCreateMission);
refreshCreateMission();

// ---------- LABELING MISSION ----------
const MISSION_KEY = "mira_labeling_mission_v2";
let mission = JSON.parse(localStorage.getItem(MISSION_KEY) || "null") || {
  goal: 100, flag: "⚑", active: false, started_at: null, starting_labeled: 0, generated_total: 0
};
let missionPresets = [];

function saveMissionLocal() { localStorage.setItem(MISSION_KEY, JSON.stringify(mission)); }
function missionPercent(labeled) { return Math.min(100, Math.max(0, (labeled / Math.max(1, mission.goal)) * 100)); }
function setMissionFlag(flag) {
  mission.flag = flag || "⚑";
  saveMissionLocal();
  document.getElementById("mission-flag-cloth").textContent = mission.flag;
  document.querySelectorAll(".mission-flag-choice").forEach((b) => b.classList.toggle("is-active", b.dataset.flag === mission.flag));
}
function renderMissionPresets() {
  const el = document.getElementById("mission-preset-list");
  if (!missionPresets.length) { el.innerHTML = `<span class="mission-empty-inline">No presets yet — save a goal you like.</span>`; return; }
  el.innerHTML = missionPresets.map((p) => `<div class="mission-preset"><button class="mission-preset-load" type="button" data-preset-id="${p.id}">${escapeHtml(p.flag)} ${escapeHtml(p.name)} · ${p.goal}</button><button class="mission-preset-delete" type="button" aria-label="Delete ${escapeHtml(p.name)}" data-delete-preset-id="${p.id}">×</button></div>`).join("");
}
function renderMissionHistory(history) {
  const el = document.getElementById("mission-history-list");
  if (!history?.length) { el.innerHTML = `<div class="mission-history-empty">No completed missions yet.</div>`; return; }
  el.innerHTML = history.slice(0, 20).map((h) => {
    const date = new Date(h.completed_at).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" });
    const time = new Date(h.completed_at).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
    return `<div class="mission-history-item"><span class="mission-history-flag">${escapeHtml(h.flag || "⚑")}</span><div class="mission-history-copy"><strong>${Number(h.labeled_total || h.goal)} labeled · goal ${Number(h.goal)}</strong><span>${date} · ${time}</span></div><span class="mission-history-total">${Number(h.generated_total || 0)} generated</span></div>`;
  }).join("");
}
function updateMission(labeledTotal, history = null) {
  const goal = Math.max(1, Number(mission.goal) || 100);
  const labeled = mission.active ? Math.max(0, Number(labeledTotal) - Number(mission.starting_labeled || 0)) : 0;
  const shown = Math.min(goal, labeled);
  const pct = missionPercent(shown);
  document.getElementById("mission-goal").value = goal;
  document.getElementById("mission-title").textContent = mission.active ? `Label ${goal} activities.` : `Label ${goal} activities.`;
  document.getElementById("mission-progress-text").textContent = `${shown} / ${goal} labeled`;
  document.getElementById("mission-remaining-text").textContent = `${Math.max(0, goal - shown)} to go`;
  document.getElementById("mission-progress-fill").style.width = `${pct}%`;
  document.getElementById("mission-node-create").classList.toggle("is-done", mission.active && shown > 0);
  document.getElementById("mission-node-create").classList.toggle("is-active", !mission.active);
  document.getElementById("mission-node-label").classList.toggle("is-active", mission.active && shown < goal);
  document.getElementById("mission-node-label").classList.toggle("is-done", mission.active && shown >= goal);
  document.getElementById("mission-node-goal").classList.toggle("is-active", shown >= goal);
  document.getElementById("mission-node-goal").classList.toggle("is-done", shown >= goal);
  const lines = document.querySelectorAll(".mission-flow-line i");
  if (lines[0]) lines[0].style.width = `${mission.active ? Math.min(100, pct) : 0}%`;
  if (lines[1]) lines[1].style.width = `${shown >= goal ? 100 : 0}%`;
  const status = document.getElementById("mission-status");
  status.textContent = shown >= goal ? "Complete" : mission.active ? "In progress" : "Ready";
  status.classList.toggle("is-complete", shown >= goal);
  if (history) renderMissionHistory(history);
}
function getMissionOwner() { return document.getElementById("labeler-name")?.value.trim() || "default"; }

async function refreshMission() {
  try {
    const [entryData, missionData] = await Promise.all([api("/entries?status=all&limit=1"), api(`/missions?owner=${encodeURIComponent(getMissionOwner())}`)]);
    missionPresets = missionData.presets || [];
    renderMissionPresets();
    const total = Number(entryData.counts?.yes || 0) + Number(entryData.counts?.no || 0);
    if (mission.active && total - Number(mission.starting_labeled || 0) >= Number(mission.goal || 100)) {
      const result = await api("/missions", { method:"POST", body:JSON.stringify({ action:"complete", owner:getMissionOwner(), goal:mission.goal, flag:mission.flag, started_at:mission.started_at, starting_labeled:mission.starting_labeled, generated_total:mission.generated_total }) });
      mission.active = false; mission.started_at = null; mission.starting_labeled = 0; mission.generated_total = 0; saveMissionLocal();
      showToast(`Mission complete — ${result.labeled_total} labels logged.`, "success");
      const refreshed = await api(`/missions?owner=${encodeURIComponent(getMissionOwner())}`);
      renderMissionHistory(refreshed.history || []);
    }
    updateMission(total);
  } catch (error) { showToast(error.message, "error"); }
}

document.getElementById("mission-goal").addEventListener("change", () => {
  const value = Math.max(1, Math.min(10000, Number(document.getElementById("mission-goal").value) || 100));
  mission.goal = value; saveMissionLocal(); refreshMission();
});
document.querySelectorAll(".mission-flag-choice").forEach((button) => button.addEventListener("click", () => setMissionFlag(button.dataset.flag)));
document.getElementById("mission-run-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const goal = Math.max(1, Math.min(10000, Number(document.getElementById("mission-goal").value) || 100));
  mission.goal = goal;
  setBusy(button, true, "Launching…");
  try {
    const data = await api("/entries?status=all&limit=1");
    const labeledTotal = Number(data.counts?.yes || 0) + Number(data.counts?.no || 0);
    if (!mission.active) {
      const started = await api("/missions", { method:"POST", body:JSON.stringify({ action:"start", owner:getMissionOwner(), goal, flag:mission.flag }) });
      mission.active = true; mission.started_at = started.mission.started_at; mission.starting_labeled = Number(started.mission.starting_labeled || labeledTotal); mission.generated_total = 0; saveMissionLocal();
    }
    const already = Math.max(0, labeledTotal - Number(mission.starting_labeled || labeledTotal));
    const { counts } = await api("/entries?status=unlabeled&limit=1");
    const queued = Number(counts?.unlabeled || 0);
    const needed = Math.max(0, goal - already - queued);
    if (needed > 0) {
      let remaining = needed;
      let generated = 0;
      while (remaining > 0) {
        const batch = Math.min(1000, remaining);
        const result = await api("/generate", { method:"POST", body:JSON.stringify({ count:batch }) });
        generated += Number(result.generated || 0);
        remaining -= Number(result.generated || 0);
        if (!result.generated || result.exhausted) break;
      }
      mission.generated_total += generated; saveMissionLocal();
      showToast(`Mission loaded ${generated} fresh activities.`, generated ? "success" : "error");
    } else showToast("Your mission queue is ready — keep labeling!", "success");
    await refreshMission();
    await activateTab("label");
  } catch (error) { showToast(error.message, "error"); }
  finally { setBusy(button, false); }
});
document.getElementById("mission-save-preset-btn").addEventListener("click", async () => {
  const goal = Math.max(1, Math.min(10000, Number(document.getElementById("mission-goal").value) || 100));
  const defaultName = `Mission · ${goal}`;
  const name = prompt("Name this mission preset:", defaultName);
  if (!name?.trim()) return;
  try { await api("/missions", { method:"POST", body:JSON.stringify({ action:"preset", owner:getMissionOwner(), name:name.trim(), goal, flag:mission.flag }) }); await refreshMission(); showToast("Mission preset saved.", "success"); }
  catch (error) { showToast(error.message, "error"); }
});
document.getElementById("mission-preset-list").addEventListener("click", async (event) => {
  const load = event.target.closest("[data-preset-id]");
  const del = event.target.closest("[data-delete-preset-id]");
  if (load) { const preset = missionPresets.find((p) => String(p.id) === load.dataset.presetId); if (preset) { mission.goal = Number(preset.goal); setMissionFlag(preset.flag); saveMissionLocal(); document.getElementById("mission-goal").value = mission.goal; refreshMission(); showToast(`${preset.name} loaded.`); } }
  if (del) { if (!confirm("Delete this mission preset?")) return; try { await api("/missions", { method:"POST", body:JSON.stringify({ action:"delete_preset", owner:getMissionOwner(), id:Number(del.dataset.deletePresetId) }) }); await refreshMission(); } catch(error) { showToast(error.message,"error"); } }
});
document.getElementById("mission-refresh-history-btn").addEventListener("click", refreshMission);
refreshMission();

// ---------- LABEL ----------
const HIGHLIGHT_COLORS = ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#ddd6fe", "#fed7aa"];
const labelerInput = document.getElementById("labeler-name");
labelerInput.value = localStorage.getItem("mira_labeler_name") || "";
labelerInput.addEventListener("input", () => { localStorage.setItem("mira_labeler_name", labelerInput.value); refreshMission(); refreshCreateMission(); });
let currentEntry = null;
let labelEntries = [];
let labelIndex = -1;
let labelingBusy = false;

function tokenize(text) {
  const stop = new Set(["i","a","an","the","to","for","with","and","of","on","in","my","me","want","need","can","help","someone","who","looking","someone"]);
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)))];
}
function crossCategorySharedTokens(entry) {
  const offerTokens = new Set(entry.offers.flatMap(tokenize));
  const wantTokens = new Set(entry.wants.flatMap(tokenize));
  return [...offerTokens].filter((token) => wantTokens.has(token));
}
function highlightCrossCategory(texts, sharedTokens) {
  const colorFor = Object.fromEntries(sharedTokens.map((t, i) => [t, HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length]]));
  return texts.map((text) => {
    const escaped = escapeHtml(text);
    if (!sharedTokens.length) return escaped;
    const pattern = new RegExp(`\\b(${sharedTokens.map((t) => t.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    return escaped.replace(pattern, (m) => `<mark style="background:${colorFor[m.toLowerCase()]}">${m}</mark>`);
  });
}

async function fetchLabelEntries() {
  const { entries, counts } = await api("/entries?status=all&limit=500");
  labelEntries = entries;
  document.getElementById("label-progress").textContent = `${Number(counts.unlabeled || 0)} unlabeled · ${Number(counts.total || 0)} total`;
  const done = Number(counts.total || 0) - Number(counts.unlabeled || 0);
  document.getElementById("progress-fill").style.width = counts.total ? `${(done / counts.total) * 100}%` : "0%";
  document.getElementById("metric-unlabeled").textContent = Number(counts.unlabeled || 0);
  return labelEntries;
}

function updateLabelNavigation() {
  document.getElementById("label-back-btn").disabled = labelIndex <= 0;
  document.getElementById("label-forward-btn").disabled = labelIndex < 0 || labelIndex >= labelEntries.length - 1;
  document.getElementById("label-reset-btn").disabled = !currentEntry;
  document.getElementById("label-delete-btn").disabled = !currentEntry;
  const state = currentEntry?.status === "labeled" ? `Labeled: ${currentEntry.human_label === "yes" ? "Match" : "No match"}` : "Unlabeled";
  document.getElementById("entry-state-label").textContent = state;
}

async function showLabelEntry(entry, index = labelEntries.findIndex((e) => e.id === entry?.id)) {
  if (!entry) return;
  currentEntry = entry;
  labelIndex = index;
  document.getElementById("label-empty").hidden = true;
  const card = document.getElementById("label-card"); card.hidden = false; card.classList.add("is-loading");
  document.getElementById("entry-index-label").textContent = `Entry #${entry.id} · ${labelIndex + 1}/${labelEntries.length}`;
  document.getElementById("entry-detail-label").textContent = entry.labeled_at ? `Last labeled ${new Date(entry.labeled_at).toLocaleString()} · ${entry.labeler || "unknown"}` : "Not labeled yet";
  await renderEntry(entry);
  updateLabelNavigation();
  requestAnimationFrame(() => card.classList.remove("is-loading"));
}

async function loadNextEntry() {
  try {
    await fetchLabelEntries();
    const firstUnlabeled = labelEntries.findIndex((entry) => entry.status === "unlabeled");
    if (firstUnlabeled < 0) {
      currentEntry = labelEntries[labelEntries.length - 1] || null;
      if (currentEntry) await showLabelEntry(currentEntry, labelEntries.length - 1);
      else { document.getElementById("label-card").hidden = true; document.getElementById("label-empty").hidden = false; }
      return;
    }
    await showLabelEntry(labelEntries[firstUnlabeled], firstUnlabeled);
  } catch (error) { showToast(error.message, "error"); }
}

async function renderEntry(entry) {
  const sharedTokens = crossCategorySharedTokens(entry);
  const offerHtml = highlightCrossCategory(entry.offers, sharedTokens);
  const wantHtml = highlightCrossCategory(entry.wants, sharedTokens);
  document.getElementById("entry-offers").innerHTML = entry.offers.map((text, i) => `<div class="entry-item"><div class="en">${offerHtml[i]}</div></div>`).join("");
  document.getElementById("entry-wants").innerHTML = entry.wants.map((text, i) => `<div class="entry-item"><div class="en">${wantHtml[i]}</div></div>`).join("");
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
document.getElementById("label-back-btn").addEventListener("click", async () => { if (labelIndex > 0) await showLabelEntry(labelEntries[labelIndex - 1], labelIndex - 1); });
document.getElementById("label-forward-btn").addEventListener("click", async () => { if (labelIndex < labelEntries.length - 1) await showLabelEntry(labelEntries[labelIndex + 1], labelIndex + 1); });

document.getElementById("label-reset-btn").addEventListener("click", async () => {
  if (!currentEntry || !confirm(`Reset Entry #${currentEntry.id} and return it to the unlabeled queue?`)) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  try {
    await api("/label", { method: "PUT", body: JSON.stringify({ id: currentEntry.id, labeler, acted_at: formatLocalISO(new Date()) }) });
    showToast(`Entry #${currentEntry.id} reset.`, "success");
    await loadNextEntry(); await loadLabelHistory(); await refreshMission();
  } catch (error) { showToast(error.message, "error"); }
});

document.getElementById("label-delete-btn").addEventListener("click", async () => {
  if (!currentEntry || !confirm(`Permanently delete Entry #${currentEntry.id}? This cannot be undone.`)) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  try {
    await api(`/label?id=${encodeURIComponent(currentEntry.id)}&labeler=${encodeURIComponent(labeler)}`, { method: "DELETE" });
    showToast(`Entry #${currentEntry.id} deleted.`, "success");
    await loadNextEntry(); await loadLabelHistory(); await refreshMission();
  } catch (error) { showToast(error.message, "error"); }
});

async function labelCurrent(humanLabel) {
  if (!currentEntry || labelingBusy) return;
  const labeler = labelerInput.value.trim();
  if (!labeler) { labelerInput.focus(); showToast("Enter your labeler name first.", "error"); return; }
  labelingBusy = true;
  const yes = humanLabel === "yes"; const feedback = document.getElementById("label-feedback");
  document.getElementById("feedback-yes-icon").hidden = !yes; document.getElementById("feedback-no-icon").hidden = yes; feedback.classList.add("is-active");
  try {
    await api("/label", { method: "POST", body: JSON.stringify({ id: currentEntry.id, human_label: humanLabel, labeler, labeled_at: formatLocalISO(new Date()) }) });
    await new Promise((resolve) => setTimeout(resolve, 150)); feedback.classList.remove("is-active");
    showToast(currentEntry.status === "labeled" ? `Entry #${currentEntry.id} updated.` : `Entry #${currentEntry.id} labeled.`, "success");
    await loadNextEntry(); await loadLabelHistory(); await refreshMission();
  } catch (error) { feedback.classList.remove("is-active"); showToast(error.message, "error"); }
  finally { labelingBusy = false; }
}
document.getElementById("label-no").addEventListener("click", () => labelCurrent("no"));
document.getElementById("label-yes").addEventListener("click", () => labelCurrent("yes"));
document.addEventListener("keydown", (event) => {
  if (!document.getElementById("panel-label").classList.contains("is-active") || labelingBusy) return;
  const tag = document.activeElement?.tagName; if (["INPUT","TEXTAREA","BUTTON","SELECT"].includes(tag)) return;
  if (event.key.toLowerCase() === "y") labelCurrent("yes");
  if (event.key.toLowerCase() === "n") labelCurrent("no");
  if (event.key === "ArrowLeft" && labelIndex > 0) document.getElementById("label-back-btn").click();
  if (event.key === "ArrowRight" && labelIndex < labelEntries.length - 1) document.getElementById("label-forward-btn").click();
});

async function loadLabelHistory() {
  try {
    const { history } = await api("/history");
    const el = document.getElementById("label-history-list");
    if (!history?.length) { el.innerHTML = `<div class="history-empty">No labeling actions yet.</div>`; return; }
    el.innerHTML = history.map((h) => `<div class="history-row">
      <div class="history-icon">${h.action === "labeled" ? "✓" : h.action === "changed" ? "↻" : h.action === "reset" ? "↺" : "×"}</div>
      <div class="history-main"><strong>Entry #${h.entry_id}</strong><span>${escapeHtml(h.details || h.action)}</span></div>
      <div class="history-meta"><strong>${h.new_label ? (h.new_label === "yes" ? "Match" : "No match") : h.action}</strong><span>${escapeHtml(h.labeler || "Unknown")} · ${new Date(h.acted_at).toLocaleString()}</span></div>
    </div>`).join("");
  } catch (error) { showToast(error.message, "error"); }
}
document.getElementById("refresh-history-btn")?.addEventListener("click", loadLabelHistory);

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
  { name:"sports", test:/baseball|softball|soccer|basketball|football|tennis|climbing|running|swim|skate|ski|golf|disc golf|longboard|cycling|sports/i,
    want:["find a practice partner","join a beginner-friendly group","get feedback on technique","build a consistent practice routine","learn drills from someone experienced"],
    offer:["practice with a beginner","share drills and technique tips","help someone build a routine","give friendly feedback","teach the basics"],
    subjects:["training partners","practice sessions","skill-building","beginner coaching"] },
  { name:"learning", test:/math|algebra|calculus|science|chemistry|physics|biology|history|economics|coding|programming|school|study|homework|research/i,
    want:["find a study partner","work through examples together","get help with the tricky parts","practice with someone at a similar level","turn the topic into a small project"],
    offer:["study together","explain the basics clearly","work through practice problems","share study strategies","help someone review a topic"],
    subjects:["study partners","practice sessions","peer tutoring","small projects"] },
  { name:"creative", test:/art|draw|paint|design|photo|photography|video|film|illustrat|craft|sew|knit|ceramic|music|guitar|piano|sing|instrument|band/i,
    want:["find a creative collaborator","get feedback on a project","practice with someone who shares the interest","learn a technique from another maker","start a small collaborative project"],
    offer:["share creative feedback","collaborate on a small project","teach a beginner technique","practice together","help someone develop an idea"],
    subjects:["creative collaboration","project feedback","skill swaps","practice sessions"] },
  { name:"language", test:/language|spanish|french|chinese|mandarin|japanese|korean|english|german|italian|conversation/i,
    want:["find a conversation partner","practice casually with someone","build confidence speaking","trade language practice","learn useful everyday phrases"],
    offer:["practice conversation","help with everyday vocabulary","trade language practice","give friendly pronunciation feedback","chat at a comfortable beginner pace"],
    subjects:["conversation partners","language exchanges","pronunciation practice","everyday vocabulary"] },
  { name:"food", test:/cook|bake|food|recipe|chef|cooking|bread|ferment|coffee|tea|latte/i,
    want:["swap recipes and techniques","cook alongside someone","learn a beginner-friendly technique","get feedback on a recipe","try a small cooking project together"],
    offer:["share recipes and techniques","cook alongside a beginner","teach a simple technique","swap meal ideas","help troubleshoot a recipe"],
    subjects:["recipe swaps","cooking sessions","technique sharing","small food projects"] },
  { name:"outdoors", test:/travel|trip|hike|camp|outdoor|garden|bonsai|bird|beehive|aquaponic|compost|nature|telescope/i,
    want:["find someone to explore with","learn practical beginner tips","plan a small outdoor project","get advice from someone experienced","join a local-interest activity"],
    offer:["share practical beginner tips","plan an activity together","teach the basics","help with setup and troubleshooting","share experience from a similar project"],
    subjects:["activity partners","beginner guidance","project planning","local-interest groups"] },
];

function normalizeHelperText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function sentenceCase(value) { const t = normalizeHelperText(value); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
function detectHelperField(text) { return helperFieldSets.find((item) => item.test.test(text)); }
function helperTopic(text) {
  return normalizeHelperText(text).replace(/[.!?]+$/, "").replace(/^(i\s+(want|need|would like|am looking for|can|offer|teach)|i'm\s+looking for|looking for)\s+/i, "").trim() || "a new skill";
}
function genericField() {
  return { name:"general", want:["find someone interested too","learn from someone with experience","practice with a partner","turn the idea into a small project","get feedback and practical tips"], offer:["share what I know","practice with someone who is learning","give beginner-friendly guidance","swap ideas and resources","help someone get started"], subjects:["practice partners","skill swaps","beginner sessions","collaborative projects"] };
}
function helperBaseIdeas(text, perspective="want") {
  const topic = helperTopic(text); const field = detectHelperField(text) || genericField();
  const pool = perspective === "offer" ? field.offer : field.want;
  return [
    ...pool.slice(0,5).map((action) => perspective === "offer" ? `I can ${action} around ${topic}.` : `I want to ${action} around ${topic}.`),
    ...field.subjects.slice(0,3).map((subject) => perspective === "offer" ? `I can offer a ${subject} focused on ${topic}.` : `I'd like to find ${subject} related to ${topic}.`),
  ];
}
function finishIdeas(text) {
  const base = sentenceCase(normalizeHelperText(text)).replace(/[.!?]+$/, "");
  if (!base) return helperBaseIdeas("a new skill");
  const lower = base.toLowerCase();
  const endings = lower.startsWith("i want") || lower.startsWith("i'd like")
    ? [" so I can practice and improve.", " with someone at a similar level.", " and make it practical for a real project.", " while keeping it relaxed and beginner-friendly.", " and meet someone who is interested too.", " with a clear first step I can try this week."]
    : lower.startsWith("i can") || lower.startsWith("i offer")
      ? [" for someone who wants to learn and practice.", " and tailor it to a beginner-friendly level.", " while keeping it practical and easy to follow.", " through a short hands-on session.", " and share a few resources to get started.", " with room for questions and feedback."]
      : [" as a skill I can learn or share.", " with someone who can exchange ideas and feedback.", " through a small, practical project.", " in a relaxed, beginner-friendly way.", " with a clear first step and a simple goal.", " by finding someone interested in the same topic."];
  return endings.map((end) => `${base}${end}`);
}
function rephraseIdeas(text) {
  const topic = helperTopic(text); const field = detectHelperField(text);
  const core = [
    `I'd like to explore ${topic} with someone who is interested too.`,
    `I'm looking for a chance to learn, practice, or share ${topic}.`,
    `I want to turn ${topic} into a clear, specific activity I can pursue.`,
    `I'd love to connect with someone who can exchange practical ideas about ${topic}.`,
    `I'm interested in a beginner-friendly way to learn more about ${topic}.`,
  ];
  if (field) core.push(`I'd like to find a ${field.subjects[0]} focused on ${topic}.`);
  return core;
}
function brainstormIdeas(text) {
  const topic = helperTopic(text); const field = detectHelperField(text) || genericField();
  const wants = field.want.slice(0,5).map((x) => `Want: ${sentenceCase(x)} around ${topic}.`);
  const offers = field.offer.slice(0,5).map((x) => `Offer: ${sentenceCase(x)} around ${topic}.`);
  const collaborations = [
    `Collaborate: build a small ${topic} project together.`,
    `Exchange: trade tips, resources, or practice time around ${topic}.`,
    `Meet: find a local or online group interested in ${topic}.`,
    `Challenge: set a simple 7-day goal connected to ${topic}.`,
    `Teach-back: learn ${topic} and explain one useful part to someone else.`,
  ];
  return [...wants, ...offers, ...collaborations];
}
function diversifyIdeas(ideas, limit=8) {
  const seen = new Set();
  return ideas.map(normalizeHelperText).filter((idea) => {
    const key = idea.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if (!key || seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, limit);
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
  if (!text) { helperStatus.textContent = "Give me a little spark"; helperInput.focus(); showToast("Type a topic or partly written phrase first.", "error"); return; }
  helperStatus.textContent = "Exploring possibilities…";
  const ideas = helperMode === "finish" ? diversifyIdeas(finishIdeas(text), 8)
    : helperMode === "brainstorm" ? diversifyIdeas(brainstormIdeas(text), 10)
    : diversifyIdeas(rephraseIdeas(text), 8);
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
