class LightSchedulerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._periods = [];
    this._areaOverrides = [];
    this._editIdx = null;
    this._editType = "global"; // "global" or "area"
    this._editAreaIdx = null;
  }

  set hass(h) {
    this._hass = h;
    if (!this._b) { this._build(); this._b = 1; this._load(); }
    else { this._updateActive(); }
  }
  set panel(p) { this._p = p; }

  /* ── Time picker (reused from zone manager pattern) ── */
  _makeTimePicker(prefix, container) {
    container.innerHTML = `
      <select id="${prefix}Type" style="width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);margin-bottom:8px;">
        <option value="fixed">Fixed time</option>
        <option value="sunrise">Sunrise</option>
        <option value="sunset">Sunset</option>
      </select>
      <div id="${prefix}Fixed">
        <input type="time" id="${prefix}Time" style="width:100%;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);">
      </div>
      <div id="${prefix}Sun" style="display:none;gap:8px;align-items:center;">
        <select id="${prefix}Dir" style="padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);">
          <option value="+">After (+)</option>
          <option value="-">Before (-)</option>
        </select>
        <input type="number" id="${prefix}H" value="0" min="0" max="12" style="width:60px;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);" placeholder="h">
        <span style="color:var(--secondary-text-color);">h</span>
        <input type="number" id="${prefix}M" value="0" min="0" max="59" style="width:60px;padding:8px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color);" placeholder="m">
        <span style="color:var(--secondary-text-color);">m</span>
      </div>`;

    const typeEl = container.querySelector(`#${prefix}Type`);
    const fixedEl = container.querySelector(`#${prefix}Fixed`);
    const sunEl = container.querySelector(`#${prefix}Sun`);

    typeEl.onchange = () => {
      fixedEl.style.display = typeEl.value === "fixed" ? "" : "none";
      sunEl.style.display = (typeEl.value === "sunrise" || typeEl.value === "sunset") ? "flex" : "none";
    };
  }

  _setTimePicker(prefix, value) {
    const $ = id => this.shadowRoot.getElementById(id);
    const typeEl = $(`${prefix}Type`);
    const fixedEl = $(`${prefix}Fixed`);
    const sunEl = $(`${prefix}Sun`);

    if (!value) {
      typeEl.value = "fixed";
      fixedEl.style.display = "";
      sunEl.style.display = "none";
      $(`${prefix}Time`).value = "";
      return;
    }

    const v = value.trim().toLowerCase();
    if (v.startsWith("sunrise") || v.startsWith("sunset")) {
      const kind = v.startsWith("sunrise") ? "sunrise" : "sunset";
      typeEl.value = kind;
      fixedEl.style.display = "none";
      sunEl.style.display = "flex";
      const rest = v.slice(kind.length);
      let dir = "+", hrs = 0, mins = 0;
      if (rest.startsWith("-")) dir = "-";
      const numStr = rest.replace(/^[+-]/, "");
      const hMatch = numStr.match(/(\d+)h/);
      const mMatch = numStr.match(/(\d+)m?$/);
      if (hMatch) hrs = parseInt(hMatch[1]);
      if (mMatch && !numStr.endsWith("h")) mins = parseInt(mMatch[1]);
      if (!hMatch && !numStr.includes("m") && numStr) mins = parseInt(numStr) || 0;
      $(`${prefix}Dir`).value = dir;
      $(`${prefix}H`).value = hrs;
      $(`${prefix}M`).value = mins;
    } else {
      typeEl.value = "fixed";
      fixedEl.style.display = "";
      sunEl.style.display = "none";
      $(`${prefix}Time`).value = v;
    }
  }

  _getTimePicker(prefix) {
    const $ = id => this.shadowRoot.getElementById(id);
    const type = $(`${prefix}Type`).value;
    if (type === "fixed") return $(`${prefix}Time`).value || "";
    const dir = $(`${prefix}Dir`).value;
    const h = parseInt($(`${prefix}H`).value) || 0;
    const m = parseInt($(`${prefix}M`).value) || 0;
    if (!h && !m) return type;
    let offset = dir;
    if (h) offset += h + "h";
    if (m) offset += m + "m";
    return type + offset;
  }

  /* ── Build ── */
  _build() {
    this.shadowRoot.innerHTML = `
    <style>
      :host { display:block; padding:24px 24px 60px; max-width:1060px; margin:0 auto;
        font-family:var(--ha-card-font-family,Roboto,sans-serif); color:var(--primary-text-color); }
      .hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; }
      h1 { margin:0; font-size:1.5em; font-weight:400; }
      .sub { color:var(--secondary-text-color); font-size:.85em; margin-top:4px; }
      h2 { font-size:1.15em; font-weight:500; margin:28px 0 12px; }
      .btn { background:var(--primary-color); color:#fff; border:none; border-radius:10px;
        padding:10px 20px; cursor:pointer; font-size:.95em; font-weight:500; }
      .btn:hover { opacity:.85; }
      .btn-sec { background:var(--divider-color); color:var(--primary-text-color); border:none;
        border-radius:10px; padding:10px 20px; cursor:pointer; font-size:.95em; font-weight:500; }
      .btn-sec:hover { opacity:.85; }
      .btn-sm { padding:6px 14px; font-size:.85em; border-radius:8px; }
      .card { background:var(--ha-card-background,var(--card-background-color)); border-radius:12px;
        overflow:hidden; box-shadow:var(--ha-card-box-shadow,0 2px 6px rgba(0,0,0,.1)); margin-bottom:20px; }
      table { width:100%; border-collapse:collapse; }
      th { text-align:left; padding:14px 16px; background:var(--table-header-background-color,rgba(0,0,0,.04));
        color:var(--secondary-text-color); font-size:.78em; font-weight:600; text-transform:uppercase; letter-spacing:.8px; }
      td { padding:14px 16px; border-top:1px solid var(--divider-color); vertical-align:middle; }
      tr:first-child td { border-top:none; }
      tr:hover td { background:rgba(0,0,0,.02); }
      tr.active-row td { background:rgba(76,175,80,.08); }
      .acts { display:flex; gap:6px; }
      .abtn { background:none; border:1px solid var(--divider-color); cursor:pointer;
        padding:5px 10px; border-radius:6px; color:var(--primary-text-color); font-size:.83em; }
      .abtn:hover { background:var(--divider-color); }
      .abtn.del { color:var(--error-color,#db4437); border-color:currentColor; }
      .abtn.del:hover { background:var(--error-color); color:#fff; }
      .empty { text-align:center; padding:40px 24px; color:var(--secondary-text-color); }
      .empty-icon { font-size:2.5em; margin-bottom:12px; opacity:.35; }
      .ov { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:999;
        justify-content:center; align-items:center; }
      .ov.open { display:flex; }
      .modal { background:var(--ha-card-background,var(--card-background-color,#fff)); border-radius:16px;
        padding:28px; width:90%; min-width:360px; max-width:520px; box-shadow:0 8px 32px rgba(0,0,0,.3);
        max-height:85vh; overflow-y:auto; }
      .modal h2 { margin:0 0 20px; font-weight:400; font-size:1.3em; }
      .f { margin-bottom:16px; }
      .f label { display:block; margin-bottom:6px; font-size:.83em; color:var(--secondary-text-color); font-weight:500; }
      .f select, .f input { width:100%; padding:10px 12px; border:1px solid var(--divider-color);
        border-radius:8px; background:var(--card-background-color,#fff); color:var(--primary-text-color);
        font-size:.93em; box-sizing:border-box; }
      .f select:focus, .f input:focus { outline:none; border-color:var(--primary-color); }
      .hint { font-size:.73em; color:var(--secondary-text-color); margin-top:4px; }
      .mbtns { display:flex; justify-content:flex-end; gap:10px; margin-top:24px; }
      .mbtns button { padding:10px 20px; border-radius:8px; border:none; cursor:pointer; font-size:.93em; font-weight:500; }
      .bc { background:var(--divider-color); color:var(--primary-text-color); }
      .bs { background:var(--primary-color); color:#fff; }
      .bs:hover,.bc:hover { opacity:.85; }
      .slider-row { display:flex; align-items:center; gap:12px; }
      .slider-row input[type=range] { flex:1; }
      .slider-val { min-width:50px; text-align:right; font-weight:500; }
      .preview { display:flex; gap:12px; margin-top:8px; }
      .preview-box { width:48px; height:48px; border-radius:10px; border:1px solid var(--divider-color); }
      .toggle { position:relative; display:inline-block; width:42px; height:24px; }
      .toggle input { opacity:0; width:0; height:0; }
      .toggle .slider { position:absolute; cursor:pointer; inset:0; background:#ccc; border-radius:24px; transition:.3s; }
      .toggle .slider:before { content:""; position:absolute; height:18px; width:18px; left:3px; bottom:3px;
        background:#fff; border-radius:50%; transition:.3s; }
      .toggle input:checked + .slider { background:var(--primary-color); }
      .toggle input:checked + .slider:before { transform:translateX(18px); }
      .area-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px;
        background:var(--table-header-background-color,rgba(0,0,0,.04)); border-radius:12px 12px 0 0; }
      .area-name { font-weight:500; font-size:1em; }
      .area-acts { display:flex; gap:8px; }
      .time-display { font-family:monospace; font-size:.9em; }
      .active-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#4caf50;
        box-shadow:0 0 5px #4caf50aa; margin-right:6px; vertical-align:middle; }
    </style>

    <div class="hdr">
      <div>
        <h1>Light Scheduler</h1>
        <div class="sub">Set brightness &amp; color temperature by time of day</div>
      </div>
    </div>

    <!-- Global Periods -->
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2>Global Schedule</h2>
      <button class="btn btn-sm" id="addGlobal">+ Add Period</button>
    </div>
    <div class="card"><div id="globalTable"></div></div>

    <!-- Area Overrides -->
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h2>Area Overrides</h2>
      <button class="btn btn-sm" id="addArea">+ Add Area Override</button>
    </div>
    <div id="areaOverrides"></div>

    <!-- Period Edit Modal -->
    <div class="ov" id="periodModal">
      <div class="modal">
        <h2 id="periodTitle">Add Period</h2>
        <div class="f">
          <label>Name (optional)</label>
          <input type="text" id="pName" placeholder="e.g. Evening, Night mode...">
        </div>
        <div class="f">
          <label>From</label>
          <div id="pFromPicker"></div>
        </div>
        <div class="f">
          <label>To</label>
          <div id="pToPicker"></div>
        </div>
        <div class="f">
          <label>Brightness (%)</label>
          <div class="slider-row">
            <input type="range" id="pBrightness" min="1" max="100" value="100">
            <span class="slider-val" id="pBrightnessVal">100%</span>
          </div>
        </div>
        <div class="f">
          <label>Color Temperature (Kelvin)</label>
          <div class="slider-row">
            <input type="range" id="pColorTemp" min="2000" max="6500" value="4000" step="100">
            <span class="slider-val" id="pColorTempVal">4000K</span>
          </div>
          <div class="preview">
            <div class="preview-box" id="pColorPreview"></div>
            <div style="display:flex;flex-direction:column;justify-content:center;">
              <span style="font-size:.8em;color:var(--secondary-text-color);" id="pColorLabel">Neutral White</span>
            </div>
          </div>
        </div>
        <div class="f">
          <label>Transition (seconds)</label>
          <input type="number" id="pTransition" value="2" min="0" max="60" placeholder="2">
        </div>
        <div class="f" style="display:flex;align-items:center;gap:12px;">
          <label style="margin:0;">Enabled</label>
          <label class="toggle">
            <input type="checkbox" id="pEnabled" checked>
            <span class="slider"></span>
          </label>
        </div>
        <div class="mbtns">
          <button class="bc" id="pCancel">Cancel</button>
          <button class="bs" id="pSave">Save</button>
        </div>
      </div>
    </div>

    <!-- Area Select Modal -->
    <div class="ov" id="areaModal">
      <div class="modal">
        <h2>Add Area Override</h2>
        <div class="f">
          <label>Area</label>
          <select id="aAreaSelect"></select>
        </div>
        <div class="mbtns">
          <button class="bc" id="aCancel">Cancel</button>
          <button class="bs" id="aSave">Add</button>
        </div>
      </div>
    </div>`;

    const $ = id => this.shadowRoot.getElementById(id);

    // Build time pickers
    this._makeTimePicker("pFrom", $("pFromPicker"));
    this._makeTimePicker("pTo", $("pToPicker"));

    // Brightness slider
    $("pBrightness").oninput = () => {
      $("pBrightnessVal").textContent = $("pBrightness").value + "%";
    };

    // Color temp slider
    $("pColorTemp").oninput = () => {
      const k = parseInt($("pColorTemp").value);
      $("pColorTempVal").textContent = k + "K";
      $("pColorPreview").style.background = this._kelvinToCSS(k);
      $("pColorLabel").textContent = this._kelvinLabel(k);
    };

    // Buttons
    $("addGlobal").onclick = () => this._openPeriod("global", null, null);
    $("addArea").onclick = () => this._openAreaModal();
    $("pCancel").onclick = () => this._closePeriod();
    $("pSave").onclick = () => this._savePeriod();
    $("aCancel").onclick = () => { $("areaModal").classList.remove("open"); };
    $("aSave").onclick = () => this._saveArea();
  }

  /* ── Data ── */
  async _load() {
    try {
      const r = await this._hass.connection.sendMessagePromise(
        { type: "light_scheduler/config/get" }
      );
      this._periods = r.periods || [];
      this._areaOverrides = r.area_overrides || [];
    } catch {
      this._periods = [];
      this._areaOverrides = [];
    }
    this._render();
    this._updateActive();
  }

  async _save() {
    await this._hass.connection.sendMessagePromise({
      type: "light_scheduler/config/set",
      periods: this._periods,
      area_overrides: this._areaOverrides,
    });
  }

  async _updateActive() {
    try {
      const r = await this._hass.connection.sendMessagePromise(
        { type: "light_scheduler/active_period" }
      );
      this._activePeriod = r.global;
      this._activeAreas = r.areas || {};
    } catch {
      this._activePeriod = null;
      this._activeAreas = {};
    }
    this._highlightActive();
  }

  /* ── Render ── */
  _render() {
    this._renderGlobal();
    this._renderAreas();
  }

  _renderGlobal() {
    const el = this.shadowRoot.getElementById("globalTable");
    if (!this._periods.length) {
      el.innerHTML = `<div class="empty">
        <div class="empty-icon">&#9788;</div>
        <div>No time periods defined yet. Add your first period to get started.</div>
      </div>`;
      return;
    }
    el.innerHTML = this._renderPeriodTable(this._periods, "global");
    this._bindTableActions(el, "global");
  }

  _renderAreas() {
    const el = this.shadowRoot.getElementById("areaOverrides");
    if (!this._areaOverrides.length) {
      el.innerHTML = `<div class="empty" style="padding:20px;">
        <div style="color:var(--secondary-text-color);font-size:.9em;">No area overrides. Global schedule applies to all lights.</div>
      </div>`;
      return;
    }
    let html = "";
    this._areaOverrides.forEach((ov, ai) => {
      const areaName = this._areaName(ov.area_id);
      html += `<div class="card" style="margin-bottom:16px;">
        <div class="area-header">
          <span class="area-name">${areaName}</span>
          <div class="area-acts">
            <button class="abtn btn-sm" data-action="add-area-period" data-ai="${ai}">+ Add Period</button>
            <button class="abtn del btn-sm" data-action="del-area" data-ai="${ai}">Remove Area</button>
          </div>
        </div>`;
      if (!ov.periods || !ov.periods.length) {
        html += `<div class="empty" style="padding:20px;">
          <div style="font-size:.9em;">No periods — using global schedule</div>
        </div>`;
      } else {
        html += this._renderPeriodTable(ov.periods, "area", ai);
      }
      html += `</div>`;
    });
    el.innerHTML = html;

    // Bind area actions
    el.querySelectorAll("[data-action=add-area-period]").forEach(b => {
      b.onclick = () => this._openPeriod("area", parseInt(b.dataset.ai), null);
    });
    el.querySelectorAll("[data-action=del-area]").forEach(b => {
      b.onclick = () => {
        this._areaOverrides.splice(parseInt(b.dataset.ai), 1);
        this._save();
        this._render();
      };
    });

    // Bind period table actions inside areas
    this._areaOverrides.forEach((ov, ai) => {
      const tables = el.querySelectorAll(`[data-area-idx="${ai}"] .abtn`);
      tables.forEach(b => {
        b.onclick = () => {
          const pi = parseInt(b.dataset.i);
          if (b.dataset.a === "e") this._openPeriod("area", ai, pi);
          else if (b.dataset.a === "d") {
            ov.periods.splice(pi, 1);
            this._save();
            this._render();
          }
        };
      });
    });
  }

  _renderPeriodTable(periods, type, areaIdx) {
    let h = `<table ${type === "area" ? `data-area-idx="${areaIdx}"` : `data-type="global"`}>
      <thead><tr>
        <th style="width:30px"></th>
        <th>Name</th><th>From</th><th>To</th>
        <th>Brightness</th><th>Color Temp</th><th>Transition</th>
        <th style="width:130px"></th>
      </tr></thead><tbody>`;

    periods.forEach((p, i) => {
      const enabled = p.enabled !== false;
      const name = p.name || `Period ${i + 1}`;
      const from = this._formatTime(p.from_time || "");
      const to = this._formatTime(p.to_time || "");
      const brightness = p.brightness != null ? p.brightness + "%" : "—";
      const colorTemp = p.color_temp != null ? p.color_temp + "K" : "—";
      const transition = p.transition != null ? p.transition + "s" : "2s";
      const colorCSS = p.color_temp ? this._kelvinToCSS(p.color_temp) : "#ddd";

      h += `<tr data-period-idx="${i}" style="${!enabled ? "opacity:.45;" : ""}">
        <td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${colorCSS};border:1px solid var(--divider-color);"></span></td>
        <td>${name}</td>
        <td class="time-display">${from}</td>
        <td class="time-display">${to}</td>
        <td>${brightness}</td>
        <td>${colorTemp}</td>
        <td>${transition}</td>
        <td class="acts">
          <button class="abtn" data-a="e" data-i="${i}">Edit</button>
          <button class="abtn del" data-a="d" data-i="${i}">Delete</button>
        </td>
      </tr>`;
    });
    h += "</tbody></table>";
    return h;
  }

  _bindTableActions(container, type) {
    container.querySelectorAll(".abtn").forEach(b => {
      b.onclick = () => {
        const i = parseInt(b.dataset.i);
        if (b.dataset.a === "e") this._openPeriod(type, null, i);
        else if (b.dataset.a === "d") {
          this._periods.splice(i, 1);
          this._save();
          this._render();
        }
      };
    });
  }

  _highlightActive() {
    // Highlight active global period
    const globalTable = this.shadowRoot.querySelector('[data-type="global"]');
    if (globalTable && this._activePeriod) {
      globalTable.querySelectorAll("tr[data-period-idx]").forEach(tr => {
        const idx = parseInt(tr.dataset.periodIdx);
        const p = this._periods[idx];
        if (p && p.from_time === this._activePeriod.from_time && p.to_time === this._activePeriod.to_time) {
          tr.classList.add("active-row");
          const nameCell = tr.children[1];
          if (nameCell && !nameCell.querySelector(".active-dot")) {
            nameCell.innerHTML = `<span class="active-dot"></span>${nameCell.textContent}`;
          }
        } else {
          tr.classList.remove("active-row");
        }
      });
    }
  }

  /* ── Period Modal ── */
  _openPeriod(type, areaIdx, periodIdx) {
    this._editType = type;
    this._editAreaIdx = areaIdx;
    this._editIdx = periodIdx;

    const $ = id => this.shadowRoot.getElementById(id);
    $("periodTitle").textContent = periodIdx !== null ? "Edit Period" : "Add Period";

    let p = {};
    if (periodIdx !== null) {
      if (type === "global") {
        p = this._periods[periodIdx] || {};
      } else {
        p = (this._areaOverrides[areaIdx]?.periods || [])[periodIdx] || {};
      }
    }

    $("pName").value = p.name || "";
    this._setTimePicker("pFrom", p.from_time || "");
    this._setTimePicker("pTo", p.to_time || "");
    $("pBrightness").value = p.brightness ?? 100;
    $("pBrightnessVal").textContent = ($("pBrightness").value) + "%";
    $("pColorTemp").value = p.color_temp ?? 4000;
    const k = parseInt($("pColorTemp").value);
    $("pColorTempVal").textContent = k + "K";
    $("pColorPreview").style.background = this._kelvinToCSS(k);
    $("pColorLabel").textContent = this._kelvinLabel(k);
    $("pTransition").value = p.transition ?? 2;
    $("pEnabled").checked = p.enabled !== false;

    $("periodModal").classList.add("open");
  }

  _closePeriod() {
    this.shadowRoot.getElementById("periodModal").classList.remove("open");
    this._editIdx = null;
  }

  _savePeriod() {
    const $ = id => this.shadowRoot.getElementById(id);
    const fromTime = this._getTimePicker("pFrom");
    const toTime = this._getTimePicker("pTo");

    if (!fromTime || !toTime) {
      alert("Please set both From and To times.");
      return;
    }

    const period = {
      name: $("pName").value || "",
      from_time: fromTime,
      to_time: toTime,
      brightness: parseInt($("pBrightness").value),
      color_temp: parseInt($("pColorTemp").value),
      transition: parseInt($("pTransition").value) || 2,
      enabled: $("pEnabled").checked,
    };

    if (this._editType === "global") {
      if (this._editIdx !== null) {
        this._periods[this._editIdx] = period;
      } else {
        this._periods.push(period);
      }
    } else {
      const ov = this._areaOverrides[this._editAreaIdx];
      if (!ov.periods) ov.periods = [];
      if (this._editIdx !== null) {
        ov.periods[this._editIdx] = period;
      } else {
        ov.periods.push(period);
      }
    }

    this._save();
    this._render();
    this._closePeriod();
  }

  /* ── Area Modal ── */
  _openAreaModal() {
    const $ = id => this.shadowRoot.getElementById(id);
    const sel = $("aAreaSelect");
    sel.innerHTML = "";
    const existing = new Set(this._areaOverrides.map(o => o.area_id));
    Object.values(this._hass.areas || {})
      .filter(a => !existing.has(a.area_id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(a => sel.add(new Option(a.name, a.area_id)));

    if (!sel.options.length) {
      alert("All areas already have overrides.");
      return;
    }
    $("areaModal").classList.add("open");
  }

  _saveArea() {
    const $ = id => this.shadowRoot.getElementById(id);
    const areaId = $("aAreaSelect").value;
    if (!areaId) return;
    this._areaOverrides.push({ area_id: areaId, periods: [] });
    this._save();
    this._render();
    $("areaModal").classList.remove("open");
  }

  /* ── Helpers ── */
  _areaName(id) {
    const a = Object.values(this._hass.areas || {}).find(x => x.area_id === id);
    return a ? a.name : id;
  }

  _formatTime(t) {
    if (!t) return "—";
    t = t.trim().toLowerCase();
    if (t.startsWith("sunrise")) return "&#9788; " + t;
    if (t.startsWith("sunset")) return "&#9789; " + t;
    return t;
  }

  _kelvinToCSS(k) {
    // Approximate Kelvin to RGB for preview
    let r, g, b;
    const temp = k / 100;
    if (temp <= 66) {
      r = 255;
      g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
    } else {
      r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
      g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    }
    if (temp >= 66) {
      b = 255;
    } else if (temp <= 19) {
      b = 0;
    } else {
      b = Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
    }
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }

  _kelvinLabel(k) {
    if (k <= 2500) return "Warm / Candlelight";
    if (k <= 3000) return "Warm White";
    if (k <= 3500) return "Soft White";
    if (k <= 4500) return "Neutral White";
    if (k <= 5500) return "Cool White";
    return "Daylight";
  }
}

customElements.define("light-scheduler-panel", LightSchedulerPanel);
