/* Powerflow Card v0.1.1 | MIT | https://github.com/OneScuzzie2k/powerflow-card */
const ENTITY_LABELS = {
  home: 'Home power', solar: 'Solar power', grid_import: 'Grid import power', grid_export: 'Grid export power',
  battery_charge: 'Battery charging power', battery_discharge: 'Battery discharging power', battery_soc: 'Battery percentage',
  battery_runtime: 'Battery hours remaining', backup: 'Backup load power',
  solar_to_home: 'Solar → home', solar_to_battery: 'Solar → battery', solar_to_grid: 'Solar → grid',
  grid_to_home: 'Grid → home', grid_to_battery: 'Grid → battery', battery_to_home: 'Battery → home', battery_to_grid: 'Battery → grid',
  daily_generation: 'Daily generation', daily_import: 'Daily import', daily_export: 'Daily export',
  electricity_cost: 'Net electricity cost today', forecast_tomorrow: 'Tomorrow’s solar forecast',
  charge_start: 'Charge window start', charge_end: 'Charge window end', discharge_start: 'Discharge window start', discharge_end: 'Discharge window end'
};

function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || !config.entities || typeof config.entities !== 'object' || Array.isArray(config.entities)) throw new Error('Define entities.home and your optional energy sensors.');
  const entities = {};
  for (const key of Object.keys(ENTITY_LABELS)) {
    const value = config.entities[key];
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/i.test(value)) throw new Error(`Invalid entity ID for ${ENTITY_LABELS[key]}.`);
    entities[key] = value;
  }
  if (!entities.home) throw new Error('entities.home is required (a home power sensor).');
  const threshold = config.flow_threshold ?? 50;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) throw new Error('flow_threshold must be a non-negative number in watts.');
  for (const key of ['show_daily', 'show_forecast', 'show_schedule']) if (config[key] != null && typeof config[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  if (config.title != null && typeof config.title !== 'string') throw new Error('title must be text.');
  if (config.currency != null && config.currency !== '' && (typeof config.currency !== 'string' || !/^[A-Z]{3}$/.test(config.currency))) throw new Error('currency must be a three-letter code such as GBP.');
  return { ...config, title: config.title ?? 'Power at a glance', currency:config.currency || undefined, entities, flow_threshold: threshold, show_daily: config.show_daily ?? true, show_forecast: config.show_forecast ?? true, show_schedule: config.show_schedule ?? true };
}

function numberState(state) {
  if (!state || state.state == null || String(state.state).trim() === '' || ['unknown', 'unavailable'].includes(state.state)) return null;
  const n = Number(state.state);
  return Number.isFinite(n) ? n : null;
}

function scaledState(state, kind) {
  const n = numberState(state);
  if (n === null) return null;
  const unit = state.attributes?.unit_of_measurement;
  const scales = kind === 'energy' ? { Wh: 0.001, kWh: 1, MWh: 1000 } : { W: 1, kW: 1000, MW: 1000000 };
  if (unit && !(unit in scales)) return null;
  return n * (unit ? scales[unit] : 1);
}

const formatPower = n => n === null ? 'Unavailable' : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)} kW` : `${Math.round(n)} W`;
const formatEnergy = n => n === null ? 'Unavailable' : `${n.toFixed(1)} kWh`;
function formatTime(state) {
  const raw = state?.state || '';
  const match = raw.match(/^(?:\d{4}-\d{2}-\d{2}[T ])?([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : 'Unavailable';
}

function buildModel(config, hass) {
  const states = hass?.states || {};
  const entity = key => states[config.entities[key]];
  const p = key => scaledState(entity(key), 'power');
  const n = key => numberState(entity(key));
  const threshold = config.flow_threshold;
  const values = Object.fromEntries(['home','solar','grid_import','grid_export','battery_charge','battery_discharge','backup'].map(key => [key, p(key)]));
  const { solar, grid_import: gi, grid_export: go, battery_charge: bi, battery_discharge: bo } = values;
  const active = value => value !== null && value > threshold;
  const socValue = n('battery_soc');
  const soc = socValue !== null && socValue >= 0 && socValue <= 100 ? socValue : null;
  const rawHours = n('battery_runtime');
  const runtimeUnit = entity('battery_runtime')?.attributes?.unit_of_measurement;
  const hours = rawHours === null ? null : runtimeUnit === 'min' ? rawHours / 60 : runtimeUnit === 's' ? rawHours / 3600 : rawHours;
  const liveKeys = ['home','solar','grid_import','grid_export','battery_charge','battery_discharge','battery_soc'].filter(key => config.entities[key]);
  const missing = liveKeys.some(key => key === 'battery_soc' ? soc === null : values[key] === null);
  const sources = [];
  if (active(solar)) sources.push('Solar');
  if (active(bo)) sources.push('battery');
  if (active(gi)) sources.push('grid');
  const summary = missing ? 'Some live readings are unavailable' : `${sources.length ? `${sources.join(' + ')} supplying power` : 'Low power flow'}${active(go) ? ' · exporting to grid' : ''}`;
  const configuredMissing = keys => keys.some(key => config.entities[key] && p(key) === null);
  const gridStatus = configuredMissing(['grid_import','grid_export']) ? 'Unavailable' : active(gi) && active(go) ? 'Import + export' : active(gi) ? 'Importing' : active(go) ? 'Exporting' : 'Standby';
  const batteryStatus = configuredMissing(['battery_charge','battery_discharge']) ? 'Unavailable' : active(bi) && active(bo) ? 'Charge + discharge' : active(bi) ? 'Charging' : active(bo) ? 'Discharging' : 'Standby';
  const gridValue = gridStatus === 'Unavailable' ? null : gi === null && go === null ? null : active(gi) ? gi : active(go) ? go : Math.max(gi ?? 0, go ?? 0);
  const batteryValue = batteryStatus === 'Unavailable' ? null : bi === null && bo === null ? null : active(bi) ? bi : active(bo) ? bo : Math.max(bi ?? 0, bo ?? 0);
  const flows = {};
  for (const [key, source, destination] of [
    ['solar_to_home','solar','home'],['solar_to_battery','solar','battery_charge'],['solar_to_grid','solar','grid_export'],
    ['grid_to_home','grid_import','home'],['grid_to_battery','grid_import','battery_charge'],['battery_to_home','battery_discharge','home'],['battery_to_grid','battery_discharge','grid_export']
  ]) {
    const value = p(key);
    // Never invent source allocations. Explicit route sensors must agree with configured endpoint readings.
    flows[key] = active(value) && (!config.entities[source] || active(values[source])) && (!config.entities[destination] || active(values[destination])) ? value : 0;
  }
  let cost = 'Unavailable';
  const costValue = n('electricity_cost');
  if (costValue !== null) {
    const currency = config.currency || hass?.config?.currency || 'GBP';
    const unit = entity('electricity_cost')?.attributes?.unit_of_measurement;
    const amount = unit === 'p' || unit === 'GBp' ? costValue / 100 : costValue;
    try { cost = new Intl.NumberFormat(hass?.locale?.language || 'en-GB', { style: 'currency', currency }).format(amount); }
    catch { cost = `${amount.toFixed(2)} ${currency}`; }
  }
  return { values, soc, hours, missing, summary, gridStatus, batteryStatus, gridValue, batteryValue, flows, cost,
    runtime: active(bo) ? hours !== null && hours > 0 ? `~${hours.toFixed(1)} h estimated` : 'Runtime unavailable' : batteryStatus,
    energy: Object.fromEntries(['daily_generation','daily_import','daily_export','forecast_tomorrow'].map(key => [key, formatEnergy(scaledState(entity(key),'energy'))])),
    times: Object.fromEntries(['charge_start','charge_end','discharge_start','discharge_end'].map(key => [key,formatTime(entity(key))]))
  };
}

const CARD_STYLES = "\n.pf {color:var(--primary-text-color);font-family:var(--paper-font-body1_-_font-family,inherit);}\n.pf-header {display:flex;justify-content:space-between;align-items:center;gap:8px;}\n.pf-eyebrow {font-size:10px;letter-spacing:1.8px;color:var(--secondary-text-color);font-weight:600;}\n.pf h2 {margin:5px 0 0;font-size:25px;font-weight:600;letter-spacing:-.8px;}\n.pf-live {font-size:10px;color:#159b7c;background:rgba(21,155,124,.08);padding:6px 10px;border-radius:20px;white-space:nowrap;}\n.pf-summary {font-size:12px;color:var(--secondary-text-color);margin:12px 0 0;min-height:28px;}\n.pf-diagram {height:320px;position:relative;margin:6px -8px 0;}\n.pf-diagram > svg {width:100%;height:100%;position:absolute;inset:0;overflow:visible;}\n.pf-track {fill:none;stroke:var(--divider-color);stroke-width:2;opacity:.6;}\n.pf-flow {fill:none;stroke-width:2.5;stroke-linecap:round;stroke-dasharray:3 10;animation:pf-travel 2s linear infinite;}\n.pf-node {position:absolute;transform:translate(-50%,-50%);width:104px;padding:10px 3px;border-radius:18px;border:1px solid var(--divider-color);background:var(--ha-card-background,var(--card-background-color,#fff));display:flex;align-items:center;flex-direction:column;gap:2px;box-sizing:border-box;box-shadow:0 4px 18px rgba(0,0,0,.025);}\n.pf-icon {border-radius:10px;background:color-mix(in srgb,var(--node-color) 9%,transparent);padding:6px;margin-bottom:2px;display:flex;}\n.pf-node ha-icon {color:var(--node-color);--mdc-icon-size:24px;}\n.pf-node span {font-size:11px;color:var(--secondary-text-color);}\n.pf-node strong {font-size:21px;font-weight:600;letter-spacing:-.5px;}\n.pf-node small {font-size:10px;color:var(--secondary-text-color);}\n.pf-solar {left:50%;top:16.25%;}.pf-grid {left:16.25%;top:50%;}.pf-home {left:83.75%;top:50%;}.pf-battery {left:50%;top:83.75%;}\n\n\n.pf-section-head {display:flex;justify-content:space-between;font-size:12px;margin:22px 0 14px;padding-top:17px;border-top:1px solid var(--divider-color);}.pf-section-head span {color:var(--secondary-text-color);font-size:11px;}\n.pf-daily {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}.pf-daily>div {display:flex;flex-direction:column;gap:6px;}.pf-daily span {font-size:11px;color:var(--secondary-text-color);}.pf-daily strong {font-size:22px;font-weight:500;letter-spacing:-.5px;}.pf-daily small {font-size:11px;color:var(--secondary-text-color);font-weight:400;}\n.pf-insights {display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px;}.pf-insights>div {padding:14px 12px;background:color-mix(in srgb,var(--primary-text-color) 4%,transparent);border-radius:14px;display:flex;flex-direction:column;gap:5px;min-width:0;}.pf-insights span {font-size:11px;color:var(--secondary-text-color);}.pf-insights strong {font-size:22px;font-weight:600;}.pf-insights small {font-size:10px;color:var(--secondary-text-color);font-weight:400;}\n.pf-backup {display:flex;align-items:center;gap:7px;font-size:11px;color:var(--secondary-text-color);margin-top:18px;}.pf-backup ha-icon {--mdc-icon-size:16px;}.pf-backup strong {margin-left:auto;color:var(--primary-text-color);font-weight:500;}\n.pf-schedules {margin-top:14px;padding-top:13px;border-top:1px solid var(--divider-color);font-size:11px;color:var(--secondary-text-color);}.pf-schedules>div {display:flex;gap:20px;margin-top:10px;}.pf-schedules>div>span {flex:1;display:flex;flex-direction:column;gap:5px;}.pf-schedules strong {color:var(--primary-text-color);font-weight:500;}\n.pf-note {margin-top:14px;font-size:10px;color:var(--secondary-text-color);line-height:1.4;}\n@keyframes pf-travel {to{stroke-dashoffset:-26;}}@media(prefers-reduced-motion:reduce){.pf-flow{animation:none;}}\n@media(max-width:450px){.pf-node{width:90px;}.pf-node strong{font-size:18px;}.pf h2{font-size:22px;}.pf-daily strong{font-size:19px;}}\n\n.pf-backup ha-icon {width:16px;height:16px;flex:0 0 16px;}\n\n:host { display:block; }\nha-card { display:block; border-radius:24px; padding:24px; border:1px solid var(--divider-color); box-shadow:0 8px 28px rgba(0,0,0,.05); overflow:hidden; }\n* { box-sizing:border-box; }\nbutton.pf-node { font:inherit; color:var(--primary-text-color); cursor:pointer; }\nbutton.pf-node:focus-visible { outline:2px solid var(--primary-color); outline-offset:3px; }\n.pf-node strong { font-size:21px; }\n.pf-node .pf-soc { color:var(--node-color); font-size:13px; font-weight:600; }\n.pf-node .pf-soc[hidden] { display:none; }\n.pf-battery { min-height:128px; }\n.pf-diagram { height:340px; }\n.pf-node[hidden], [hidden] { display:none !important; }\n.pf-daily { grid-template-columns:repeat(auto-fit,minmax(80px,1fr)); }\n.pf-insights { grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); }\n.pf-daily strong,.pf-insights strong { overflow-wrap:anywhere; }\n.pf-track,.pf-flow { pointer-events:stroke; }\n@media(max-width:450px) { ha-card{padding:20px 16px;} .pf-node{width:90px;} .pf-node strong{font-size:18px;} }\n\n.pf-battery-runtime{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--secondary-text-color);margin-top:24px;}.pf-battery-runtime strong{font-weight:500;white-space:nowrap;color:var(--primary-text-color);}\n\n:host{container-type:inline-size;}\n@container(max-width:380px){ha-card{padding:20px 16px;}.pf-node{width:82px;}.pf-node strong{font-size:17px;}.pf h2{font-size:21px;}.pf-daily strong{font-size:17px;}.pf-insights strong{font-size:18px;}.pf-battery-runtime{flex-wrap:wrap;gap:4px;}}\n";


class PowerflowCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._form = document.createElement('ha-form');
    this._form.computeLabel = schema => schema.label || schema.name;
    this._form.schema = [
      { name:'title', label:'Title', selector:{text:{}} },
      { name:'entities', title:'Energy sensors (home power is required)', label:'Energy sensors (home power is required)', type:'expandable', expanded:true, schema:Object.entries(ENTITY_LABELS).map(([name,label])=>({name,label,required:name==='home',selector:{entity:{domain:name.includes('start')||name.includes('end')?['time','input_datetime','sensor']:['sensor','input_number','number']}}})) },
      { name:'flow_threshold', label:'Minimum animated flow (W)', selector:{number:{min:0,max:1000,mode:'box'}} },
      { name:'currency', label:'Currency code (optional, for example GBP)', selector:{text:{}} },
      ...['daily','forecast','schedule'].map(key=>({name:`show_${key}`,label:`Show ${key}`,selector:{boolean:{}}}))
    ];
    this._form.addEventListener('value-changed', event => {
      event.stopPropagation();
      this._config = {...this._config,...event.detail.value,type:'custom:powerflow-card'};
      this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));
    });
    this.shadowRoot.append(this._form);
  }
  setConfig(config) { this._config = structuredClone(config); this._form.data = {flow_threshold:50,show_daily:true,show_forecast:true,show_schedule:true,...this._config}; }
  set hass(hass) { this._form.hass = hass; }
}
if (!customElements.get('powerflow-card-editor')) customElements.define('powerflow-card-editor',PowerflowCardEditor);


const ROUTES = [
  ['solar_to_home','M230 52 Q335 52 335 130','solar'],
  ['solar_to_battery','M200 90 V230','solar'],
  ['solar_to_grid','M170 52 Q65 52 65 130','solar'],
  ['grid_to_home','M130 160 H270','grid'],
  ['grid_to_battery','M65 190 Q65 268 170 268','grid'],
  ['battery_to_home','M230 268 Q335 268 335 190','battery'],
  ['battery_to_grid','M170 268 Q65 268 65 190','battery']
];

class PowerflowCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._boundStates = null;
  }
  static getConfigElement() { return document.createElement('powerflow-card-editor'); }
  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const find = pattern => ids.find(id => pattern.test(id) && ['W','kW'].includes(hass.states[id].attributes?.unit_of_measurement));
    const entities = {home:find(/(?:house_load|home_(?:usage|power)|house_power)/) || 'sensor.home_power'};
    const solar = find(/(?:solar_live_power|solar_power|inverter_dc_power)/);
    if (solar) entities.solar = solar;
    return {type:'custom:powerflow-card',entities};
  }
  setConfig(config) {
    this._config = normalizeConfig(config);
    this._boundStates = null;
    this._create();
    this._update();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const next = Object.values(this._config.entities).map(id=>hass.states[id]);
    const context = `${hass.locale?.language}|${hass.config?.currency}`;
    if (this._boundStates && context === this._context && next.every((state,index)=>state === this._boundStates[index])) return;
    this._boundStates = next;
    this._context = context;
    this._update();
  }
  getCardSize() { return Math.ceil((this.shadowRoot.querySelector('ha-card')?.offsetHeight || 900) / 50); }
  getGridOptions() { return {columns:12,min_columns:9,rows:'auto'}; }
  _create() {
    const node = (kind,label,icon,color) => `<button type="button" class="pf-node pf-${kind}" data-node="${kind}" style="--node-color:${color}"><div class="pf-icon"><ha-icon icon="mdi:${icon}"></ha-icon></div><span>${label}</span><strong data-value="${kind}"></strong><span class="pf-soc" data-value="soc-node" ${kind==='battery'?'':'hidden'}></span><small data-value="${kind}-status"></small></button>`;
    const daily = (key,label) => `<div data-optional="${key}"><span>${label}</span><strong data-value="${key}"></strong></div>`;
    this.shadowRoot.innerHTML = `<style>${CARD_STYLES}</style><ha-card><div class="pf">
      <div class="pf-header"><div><span class="pf-eyebrow">YOUR HOME · ENERGY</span><h2 data-value="title"></h2></div><span class="pf-live" data-value="live"></span></div>
      <p class="pf-summary" data-value="summary" aria-live="polite"></p>
      <div class="pf-diagram"><svg viewBox="0 0 400 320" preserveAspectRatio="none" role="img" aria-label="Live power flows from sources to destinations">${ROUTES.map(([key,path,color])=>`<g data-route="${key}" style="--route-color:${{solar:'#dfa32b',grid:'#9374cf',battery:'#249e84'}[color]}"><title></title><path class="pf-track" d="${path}"/><path class="pf-flow" d="${path}" style="stroke:var(--route-color)"/></g>`).join('')}</svg>
        ${node('solar','Solar','solar-power-variant','#c48712')}${node('grid','Grid','transmission-tower','#8266d0')}${node('home','Home','home-lightning-bolt','#3796d4')}${node('battery','Battery','battery','#159b7c')}
      </div>
      <div class="pf-battery-runtime" data-group="battery"><span>Battery runtime at current demand</span><strong data-value="runtime"></strong></div>
      <section data-group="daily"><div class="pf-section-head"><strong>Today so far</strong><span>Energy</span></div><div class="pf-daily">${daily('daily_generation','Generated')}${daily('daily_import','Imported')}${daily('daily_export','Exported')}</div></section>
      <div class="pf-insights" data-group="insights"><div data-optional="electricity_cost"><span>Electricity today</span><strong data-value="cost"></strong><small>Your net electricity cost</small></div><div data-optional="forecast_tomorrow"><span>Tomorrow’s solar</span><strong data-value="forecast_tomorrow"></strong><small>Generation forecast</small></div></div>
      <div class="pf-backup" data-optional="backup"><ha-icon icon="mdi:shield-home-outline"></ha-icon><span>Backup load</span><strong data-value="backup"></strong></div>
      <div class="pf-schedules" data-group="schedule"><span>Inverter schedule</span><div><span data-group="charge">Charge<strong data-value="charge-window"></strong></span><span data-group="discharge">Discharge<strong data-value="discharge-window"></strong></span></div></div>
      <div class="pf-note">Runtime is an estimate at current demand · Select a node for its history</div>
    </div></ha-card>`;
    this._els = {};
    this.shadowRoot.querySelectorAll('[data-value]').forEach(el=>{
      // soc-node exists only on the battery; other nodes keep an intentionally hidden placeholder.
      if (el.dataset.value !== 'soc-node' || el.closest('[data-node]').dataset.node === 'battery') this._els[el.dataset.value] = el;
    });
    this.shadowRoot.querySelectorAll('[data-node]').forEach(button=>button.addEventListener('click',()=>{
      const e = this._config.entities;
      const key = {solar:e.solar,home:e.home,grid:e.grid_import || e.grid_export,battery:e.battery_soc || e.battery_charge || e.battery_discharge}[button.dataset.node];
      if (key) this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:key},bubbles:true,composed:true}));
    }));
    this._configureVisibility();
  }
  _configureVisibility() {
    const c = this._config, e = c.entities;
    const hide = (selector,hidden) => { this.shadowRoot.querySelector(selector).hidden = hidden; };
    hide('[data-node="solar"]',!e.solar);
    hide('[data-node="grid"]',!e.grid_import && !e.grid_export);
    hide('[data-node="battery"]',!e.battery_charge && !e.battery_discharge && !e.battery_soc);
    hide('[data-group="battery"]',!e.battery_runtime);
    hide('[data-group="daily"]',!c.show_daily || !['daily_generation','daily_import','daily_export'].some(key=>e[key]));
    hide('[data-group="insights"]',!e.electricity_cost && (!c.show_forecast || !e.forecast_tomorrow));
    this.shadowRoot.querySelectorAll('[data-optional]').forEach(el=>{el.hidden = !e[el.dataset.optional] || (el.dataset.optional==='forecast_tomorrow' && !c.show_forecast);});
    hide('[data-group="charge"]',!e.charge_start && !e.charge_end);
    hide('[data-group="discharge"]',!e.discharge_start && !e.discharge_end);
    hide('[data-group="schedule"]',!c.show_schedule || !['charge_start','charge_end','discharge_start','discharge_end'].some(key=>e[key]));
  }
  _update() {
    if (!this._config || !this._hass || !this._els) return;
    const m = buildModel(this._config,this._hass);
    const text = (key,value) => { this._els[key].textContent = value; };
    text('title',this._config.title);
    text('live',m.missing?'Check sensors':'● Live');
    text('summary',m.summary);
    text('solar',formatPower(m.values.solar)); text('solar-status',m.values.solar===null?'Unavailable':m.values.solar>this._config.flow_threshold?'Generating':'Standby');
    text('home',formatPower(m.values.home));text('home-status','Current demand');
    text('grid',formatPower(m.gridValue));text('grid-status',m.gridStatus);
    text('battery',formatPower(m.batteryValue));text('battery-status',m.batteryStatus);
    text('soc-node',m.soc===null?'—%':`${Math.round(m.soc)}%`);
    this._els['soc-node'].hidden = !this._config.entities.battery_soc;
    text('runtime',m.runtime);
    this.shadowRoot.querySelector('[data-group="battery"]').hidden = !this._config.entities.battery_runtime || !(m.values.battery_discharge > this._config.flow_threshold);
    for (const [key,value] of Object.entries(m.energy)) text(key,value);
    text('cost',m.cost);text('backup',formatPower(m.values.backup));
    text('charge-window',`${m.times.charge_start}–${m.times.charge_end}`);text('discharge-window',`${m.times.discharge_start}–${m.times.discharge_end}`);
    for (const [key] of ROUTES) {
      const route = this.shadowRoot.querySelector(`[data-route="${key}"]`), w = m.flows[key];
      route.style.display = w > 0 ? '' : 'none';
      route.querySelector('title').textContent = `${key.replaceAll('_',' ')}: ${formatPower(w)}`;
      route.querySelector('.pf-flow').style.animationDuration = `${Math.max(.8,3-Math.min(w,5000)/2500)}s`;
    }
  }
}
if (!customElements.get('powerflow-card')) customElements.define('powerflow-card',PowerflowCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card=>card.type==='powerflow-card')) window.customCards.push({type:'powerflow-card',name:'Powerflow Card',description:'Live energy flows, battery percentage, runtime and daily insights.',preview:false,documentationURL:'https://github.com/OneScuzzie2k/powerflow-card'});
console.info('Powerflow Card 0.1.1');
