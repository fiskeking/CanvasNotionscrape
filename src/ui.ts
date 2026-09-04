// HTML for the settings page and the "Access not configured" setup page.
// The page is a self-contained single file (no external assets) so the Worker
// can serve it directly.

export function renderSetupPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Setup needed — Canvas → Notion</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 system-ui, sans-serif; margin: 0; padding: 2rem;
         max-width: 720px; margin-inline: auto; }
  code { background: rgba(127,127,127,.18); padding: .1em .35em; border-radius: 4px; }
  .card { border: 1px solid rgba(127,127,127,.3); border-radius: 12px; padding: 1.25rem 1.5rem; }
  h1 { font-size: 1.3rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>⚙️ Cloudflare Access isn't configured yet</h1>
    <p>This tool refuses to expose your Canvas and Notion tokens until it is
    protected. Set these two values (in <code>wrangler.toml</code> under
    <code>[vars]</code>, or via <code>wrangler secret put</code>) and redeploy:</p>
    <ul>
      <li><code>ACCESS_TEAM_DOMAIN</code> — e.g. <code>myteam.cloudflareaccess.com</code></li>
      <li><code>ACCESS_AUD</code> — the Audience (AUD) tag of your Access application</li>
    </ul>
    <p>See the <strong>README</strong> for how to create the Access application
    in the Cloudflare Zero Trust dashboard.</p>
  </div>
</body>
</html>`;
}

export function renderSettingsPage(email: string): string {
  const who = email ? email.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Canvas → Notion Sync</title>
<style>
  :root { color-scheme: light dark; --bd: rgba(127,127,127,.28); --mut: #888; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, -apple-system, sans-serif; margin: 0;
         padding: 1.5rem; max-width: 760px; margin-inline: auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 1.75rem 0 .6rem; }
  .who { color: var(--mut); font-size: .85rem; margin-bottom: 1rem; }
  fieldset { border: 1px solid var(--bd); border-radius: 12px; margin: 0 0 1rem;
             padding: 1rem 1.25rem; }
  legend { padding: 0 .4rem; font-weight: 600; }
  label { display: block; font-weight: 600; margin: .8rem 0 .25rem; }
  input[type=text], input[type=password], select {
    width: 100%; padding: .5rem .6rem; border: 1px solid var(--bd);
    border-radius: 8px; background: transparent; color: inherit; font: inherit; }
  .hint { color: var(--mut); font-size: .82rem; margin: .2rem 0 0; }
  .row { display: flex; gap: .5rem; align-items: center; }
  .row input { flex: 1; }
  .checks label { display: flex; align-items: center; gap: .5rem; font-weight: 500; margin: .4rem 0; }
  .checks input { width: auto; }
  button { font: inherit; font-weight: 600; padding: .55rem 1rem; border-radius: 8px;
           border: 1px solid var(--bd); background: #2563eb; color: #fff; cursor: pointer; }
  button.secondary { background: transparent; color: inherit; }
  button:disabled { opacity: .55; cursor: default; }
  .actions { display: flex; gap: .6rem; flex-wrap: wrap; margin-top: .5rem; }
  #status { border: 1px solid var(--bd); border-radius: 12px; padding: 1rem 1.25rem; }
  #log { white-space: pre-wrap; font: 12px/1.5 ui-monospace, monospace;
         background: rgba(127,127,127,.12); border-radius: 8px; padding: .6rem .8rem;
         max-height: 220px; overflow: auto; margin-top: .6rem; }
  .toast { position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
           background: #111; color: #fff; padding: .6rem 1rem; border-radius: 8px;
           opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: .95; }
  .db-link { font-size: .85rem; margin-top: .4rem; }
  a { color: #2563eb; }
</style>
</head>
<body>
  <h1>📚 Canvas → Notion Sync</h1>
  <div class="who">Signed in via Cloudflare Access${who ? " as " + who : ""}.</div>

  <fieldset>
    <legend>Canvas</legend>
    <label for="canvasBaseUrl">Canvas base URL</label>
    <input id="canvasBaseUrl" type="text" placeholder="https://yourschool.instructure.com" />
    <p class="hint">The address you use to log in, without a trailing path.</p>
    <label for="canvasToken">Canvas access token</label>
    <input id="canvasToken" type="password" placeholder="paste token" autocomplete="off" />
    <p class="hint">Canvas → Account → Settings → <em>New Access Token</em>. Leave the dots to keep the saved token.</p>
  </fieldset>

  <fieldset>
    <legend>Notion</legend>
    <label for="notionToken">Notion integration token</label>
    <input id="notionToken" type="password" placeholder="secret_… or ntn_…" autocomplete="off" />
    <p class="hint">Create an internal integration at notion.so/my-integrations, then share your target page with it.</p>
    <label for="notionParentPageId">Parent page ID (where the database is created)</label>
    <input id="notionParentPageId" type="text" placeholder="page id or full Notion URL" />
    <div class="actions" style="margin-top:.6rem">
      <button id="createDbBtn" class="secondary" type="button">Create Notion database</button>
    </div>
    <p class="db-link" id="dbLink"></p>
  </fieldset>

  <fieldset>
    <legend>What to sync</legend>
    <div class="checks">
      <label><input id="s_assignments" type="checkbox" /> Assignments</label>
      <label><input id="s_quizzes" type="checkbox" /> Quizzes</label>
      <label><input id="s_announcements" type="checkbox" /> Announcements</label>
      <label><input id="s_onlyGraded" type="checkbox" /> Only items worth points</label>
      <label><input id="s_includeGrades" type="checkbox" /> Include my grade / score</label>
    </div>
  </fieldset>

  <fieldset>
    <legend>Schedule</legend>
    <label for="intervalMinutes">Auto-sync every</label>
    <select id="intervalMinutes">
      <option value="15">15 minutes</option>
      <option value="30">30 minutes</option>
      <option value="60">1 hour</option>
      <option value="180">3 hours</option>
      <option value="360">6 hours</option>
      <option value="720">12 hours</option>
      <option value="1440">24 hours</option>
    </select>
    <p class="hint">The Worker checks every 15 minutes and syncs once this much time has passed.</p>
  </fieldset>

  <div class="actions">
    <button id="saveBtn" type="button">Save settings</button>
    <button id="syncBtn" class="secondary" type="button">Sync now</button>
  </div>

  <h2>Status</h2>
  <div id="status">
    <div id="statusLine">Loading…</div>
    <div id="log"></div>
  </div>

  <div class="toast" id="toast"></div>

<script>
(function () {
  var MASK = "••••••••";
  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  function fmtTime(ms) {
    if (!ms) return "never";
    try { return new Date(ms).toLocaleString(); } catch (e) { return String(ms); }
  }

  function loadSettings() {
    return fetch("/api/settings").then(function (r) { return r.json(); }).then(function (s) {
      $("canvasBaseUrl").value = s.canvasBaseUrl || "";
      $("canvasToken").value = s.canvasToken || "";
      $("notionToken").value = s.notionToken || "";
      $("notionParentPageId").value = s.notionParentPageId || "";
      $("s_assignments").checked = !!(s.sync && s.sync.assignments);
      $("s_quizzes").checked = !!(s.sync && s.sync.quizzes);
      $("s_announcements").checked = !!(s.sync && s.sync.announcements);
      $("s_onlyGraded").checked = !!(s.sync && s.sync.onlyGraded);
      $("s_includeGrades").checked = !!(s.sync && s.sync.includeGrades);
      $("intervalMinutes").value = String(s.intervalMinutes || 60);
      if (s.notionDatabaseId) {
        $("dbLink").innerHTML = "Database connected: <code>" + s.notionDatabaseId + "</code>";
      } else {
        $("dbLink").textContent = "No database yet — create one above.";
      }
    });
  }

  function collect() {
    return {
      canvasBaseUrl: $("canvasBaseUrl").value,
      canvasToken: $("canvasToken").value,
      notionToken: $("notionToken").value,
      notionParentPageId: $("notionParentPageId").value,
      intervalMinutes: parseInt($("intervalMinutes").value, 10),
      sync: {
        assignments: $("s_assignments").checked,
        quizzes: $("s_quizzes").checked,
        announcements: $("s_announcements").checked,
        onlyGraded: $("s_onlyGraded").checked,
        includeGrades: $("s_includeGrades").checked
      }
    };
  }

  function saveSettings() {
    var btn = $("saveBtn"); btn.disabled = true;
    return fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collect())
    }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      if (res.error) { toast("Error: " + res.error); }
      else { toast("Saved"); loadSettings(); }
    }).catch(function (e) { btn.disabled = false; toast("Error: " + e); });
  }

  function loadStatus() {
    return fetch("/api/status").then(function (r) { return r.json(); }).then(function (st) {
      var parts = [];
      parts.push("Last successful sync: " + fmtTime(st.lastSyncAt));
      if (st.counts) {
        parts.push("Created " + st.counts.created + ", updated " + st.counts.updated +
          " (" + st.counts.total + " items)");
      }
      if (st.lastError) { parts.push("⚠️ Last error: " + st.lastError); }
      $("statusLine").textContent = parts.join("  •  ");
      $("log").textContent = (st.log || []).join("\\n");
    });
  }

  $("saveBtn").addEventListener("click", saveSettings);

  $("createDbBtn").addEventListener("click", function () {
    var btn = this; btn.disabled = true; toast("Creating database…");
    // Save first so token + parent id are persisted for the server call.
    saveSettings().then(function () {
      return fetch("/api/notion/create-db", { method: "POST" });
    }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      if (res.error) { toast("Error: " + res.error); return; }
      toast("Database created");
      $("dbLink").innerHTML = 'Created: <a href="' + res.url + '" target="_blank" rel="noopener">open in Notion</a>';
      loadSettings();
    }).catch(function (e) { btn.disabled = false; toast("Error: " + e); });
  });

  $("syncBtn").addEventListener("click", function () {
    var btn = this; btn.disabled = true; toast("Syncing…");
    fetch("/api/sync", { method: "POST" }).then(function (r) { return r.json(); }).then(function (res) {
      btn.disabled = false;
      if (res.ok) { toast("Sync complete"); } else { toast("Sync failed: " + (res.error || "")); }
      loadStatus();
    }).catch(function (e) { btn.disabled = false; toast("Error: " + e); });
  });

  loadSettings().then(loadStatus);
  setInterval(loadStatus, 15000);
})();
</script>
</body>
</html>`;
}
