/* =====================================================================
   Fotomedia Business Manager — Cloud Sync Module (GitHub-backed)
   ---------------------------------------------------------------------
   Acts like Google Sheets:
   - On app boot   →  pulls latest db.json from your GitHub repo into IndexedDB
   - On any change →  pushes IndexedDB snapshot back to the same db.json (debounced 3s)
   - Same repo holds both the website files AND the data file → literally
     "data saved in the same folder as the site".
   - Works on any device: just open the GitHub Pages URL.
   ===================================================================== */

const CLOUD = (() => {
  const LS_KEY = 'fmbiz_cloud_cfg_v1';
  const PUSH_DEBOUNCE_MS = 3000;       // wait 3s after last change, then push
  const MIN_PUSH_INTERVAL_MS = 8000;   // never push faster than every 8s

  let cfg = loadCfg();
  let pushTimer = null;
  let lastPushAt = 0;
  let pushing = false;
  let lastPullAt = null;
  let lastSyncedAt = null;
  let lastError = null;
  let currentSha = null;     // SHA of the file in repo (needed for PUT)
  let suspended = false;     // when true, do NOT auto-push (used during pull / restore)
  let listeners = [];

  /* ---------------- Config storage ---------------- */
  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !c.owner || !c.repo || !c.token) return null;
      c.branch = c.branch || 'main';
      c.path   = c.path   || 'data/db.json';
      return c;
    } catch { return null; }
  }
  function saveCfg(c) {
    cfg = c;
    localStorage.setItem(LS_KEY, JSON.stringify(c));
    notify();
  }
  function clearCfg() {
    cfg = null;
    localStorage.removeItem(LS_KEY);
    notify();
  }
  function isConfigured() { return !!cfg; }
  function getCfg()       { return cfg ? { ...cfg, token: cfg.token ? '••••••••' : '' } : null; }
  function getRawCfg()    { return cfg; }

  /* ---------------- Subscribe ---------------- */
  function onChange(fn) { listeners.push(fn); }
  function notify() {
    const state = getState();
    listeners.forEach(fn => { try { fn(state); } catch(e) {} });
  }
  function getState() {
    return {
      configured: isConfigured(),
      cfg: getCfg(),
      lastPullAt, lastSyncedAt, lastError,
      pushing, hasSha: !!currentSha,
    };
  }

  /* ---------------- GitHub REST helpers ---------------- */
  function apiUrl(c) {
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(c.branch)}`;
  }
  function putUrl(c) {
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
  }
  function headers(c) {
    return {
      'Authorization': `token ${c.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  /* Unicode-safe base64 encode/decode */
  function b64encodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function b64decodeUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------------- Test connection ---------------- */
  async function testConnection(testCfg) {
    const c = testCfg || cfg;
    if (!c) throw new Error('Not configured');
    // Check repo exists & token works
    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, {
      headers: headers(c)
    });
    if (r.status === 401) throw new Error('Token galat / expired hai (401 Unauthorized)');
    if (r.status === 404) throw new Error('Repository nahi mili — username ya repo name check karo (404)');
    if (!r.ok) throw new Error(`GitHub ne reject kiya: ${r.status} ${r.statusText}`);
    const info = await r.json();
    // Check if has write access (push)
    if (info.permissions && info.permissions.push === false) {
      throw new Error('Token me write permission nahi hai — repo "Contents: Read & write" allow karo');
    }
    return info;
  }

  /* ---------------- Pull latest ---------------- */
  async function pull() {
    if (!cfg) throw new Error('Cloud sync configured nahi hai');
    const r = await fetch(apiUrl(cfg), { headers: headers(cfg), cache: 'no-store' });
    if (r.status === 404) {
      // First-time: file doesn't exist in repo yet → not an error, treat as empty
      currentSha = null;
      lastPullAt = new Date();
      lastError = null;
      notify();
      return null;
    }
    if (!r.ok) {
      lastError = `Pull failed: ${r.status} ${r.statusText}`;
      notify();
      throw new Error(lastError);
    }
    const meta = await r.json();
    currentSha = meta.sha;
    const jsonText = b64decodeUtf8(meta.content || '');
    let data;
    try { data = JSON.parse(jsonText); }
    catch(e) {
      lastError = 'Cloud me db.json corrupt hai (JSON parse failed)';
      notify();
      throw new Error(lastError);
    }
    lastPullAt = new Date();
    lastError = null;
    notify();
    return data;
  }

  /* ---------------- Push current ---------------- */
  async function pushNow(payloadObj) {
    if (!cfg) throw new Error('Cloud sync configured nahi hai');
    if (pushing) return;
    pushing = true;
    notify();
    try {
      // If we don't have a SHA yet, do a HEAD pull to get it (in case file exists)
      if (currentSha === null) {
        try {
          const r = await fetch(apiUrl(cfg), { headers: headers(cfg), cache: 'no-store' });
          if (r.ok) {
            const meta = await r.json();
            currentSha = meta.sha;
          }
        } catch(e) { /* ignore — fresh create */ }
      }

      const jsonText = JSON.stringify(payloadObj, null, 2);
      const body = {
        message: `📝 auto-sync ${new Date().toISOString()}`,
        content: b64encodeUtf8(jsonText),
        branch: cfg.branch
      };
      if (currentSha) body.sha = currentSha;

      const r = await fetch(putUrl(cfg), {
        method: 'PUT',
        headers: { ...headers(cfg), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.status === 409 || r.status === 422) {
        // SHA conflict — someone else pushed first. Re-fetch SHA and retry once.
        currentSha = null;
        const r2 = await fetch(apiUrl(cfg), { headers: headers(cfg), cache: 'no-store' });
        if (r2.ok) {
          const meta = await r2.json();
          currentSha = meta.sha;
          body.sha = currentSha;
          const r3 = await fetch(putUrl(cfg), {
            method: 'PUT',
            headers: { ...headers(cfg), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!r3.ok) throw new Error(`Push retry failed: ${r3.status}`);
          const out = await r3.json();
          currentSha = out.content?.sha || null;
        } else {
          throw new Error('Push conflict & re-sync failed');
        }
      } else if (!r.ok) {
        const t = await r.text();
        throw new Error(`Push failed ${r.status}: ${t.slice(0,200)}`);
      } else {
        const out = await r.json();
        currentSha = out.content?.sha || null;
      }
      lastPushAt = Date.now();
      lastSyncedAt = new Date();
      lastError = null;
    } catch(err) {
      lastError = err.message || String(err);
      console.error('[CloudSync] push error', err);
      throw err;
    } finally {
      pushing = false;
      notify();
    }
  }

  /* ---------------- Debounced auto-push ---------------- */
  function schedulePush(getPayload) {
    if (suspended) return;
    if (!cfg) return;
    if (pushTimer) clearTimeout(pushTimer);
    const sinceLast = Date.now() - lastPushAt;
    const wait = Math.max(PUSH_DEBOUNCE_MS, MIN_PUSH_INTERVAL_MS - sinceLast);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      try {
        const payload = await getPayload();
        await pushNow(payload);
      } catch(err) {
        // Already logged; retry once after 15s
        setTimeout(() => schedulePush(getPayload), 15000);
      }
    }, wait);
    notify();
  }

  function suspend()  { suspended = true; }
  function resume()   { suspended = false; }
  function pendingPush() { return !!pushTimer; }

  /* ---------------- Force flush before unload ---------------- */
  async function flushPending(getPayload) {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      try {
        const payload = await getPayload();
        await pushNow(payload);
      } catch(e) {}
    }
  }

  return {
    isConfigured, getCfg, getRawCfg, saveCfg, clearCfg,
    testConnection, pull, pushNow, schedulePush,
    suspend, resume, pendingPush, flushPending,
    onChange, getState,
  };
})();

window.CLOUD = CLOUD;
