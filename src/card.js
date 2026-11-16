import { normalizeConfig, buildModel, formatPower } from './model.js';
import { CARD_STYLES } from './styles.js';
import { PowerflowCardEditor } from './editor.js';

export const ROUTES = [
  ['solar_to_home','M230 52 Q335 52 335 130','solar'],
  ['solar_to_battery','M200 90 V230','solar'],
  ['solar_to_grid','M170 52 Q65 52 65 130','solar'],
  ['grid_to_home','M130 160 H270','grid'],
  ['grid_to_battery','M65 190 Q65 268 170 268','grid'],
  ['battery_to_home','M230 268 Q335 268 335 190','battery'],
  ['battery_to_grid','M170 268 Q65 268 65 190','battery']
];

export class PowerflowCard extends HTMLElement {
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
  getCardSize() { return 12; }
  getGridOptions() { return {columns:12,min_columns:9,rows:12,min_rows:8}; }
  _create() {
    const node = (kind,label,icon,color) => `<button type="button" class="pf-node pf-${kind}" data-node="${kind}" style="--node-color:${color}"><div class="pf-icon"><ha-icon icon="mdi:${icon}"></ha-icon></div><span>${label}</span><strong data-value="${kind}"></strong><span class="pf-soc" data-value="soc-node" ${kind==='battery'?'':'hidden'}></span><small data-value="${kind}-status"></small></button>`;
    const daily = (key,label) => `<div data-optional="${key}"><span>${label}</span><strong data-value="${key}"></strong></div>`;
    this.shadowRoot.innerHTML = `<style>${CARD_STYLES}</style><ha-card><div class="pf">
      <div class="pf-header"><div><span class="pf-eyebrow">YOUR HOME · ENERGY</span><h2 data-value="title"></h2></div><span class="pf-live" data-value="live"></span></div>
      <p class="pf-summary" data-value="summary" aria-live="polite"></p>
      <div class="pf-diagram"><svg viewBox="0 0 400 320" preserveAspectRatio="none" role="img" aria-label="Live power flows from sources to destinations">${ROUTES.map(([key,path,color])=>`<g data-route="${key}" style="--route-color:${{solar:'#dfa32b',grid:'#9374cf',battery:'#249e84'}[color]}"><title></title><path class="pf-track" d="${path}"/><path class="pf-flow" d="${path}" style="stroke:var(--route-color)"/></g>`).join('')}</svg>
        ${node('solar','Solar','solar-power-variant','#c48712')}${node('grid','Grid','transmission-tower','#8266d0')}${node('home','Home','home-lightning-bolt','#3796d4')}${node('battery','Battery','battery','#159b7c')}
      </div>
      <div data-group="battery"><div class="pf-battery-bar"><span data-value="soc"></span><span data-value="runtime"></span></div><div class="pf-charge-track" role="progressbar" aria-label="Battery percentage" aria-valuemin="0" aria-valuemax="100"><div></div></div></div>
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
    hide('[data-group="battery"]',!e.battery_soc && !e.battery_runtime);
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
    text('soc',m.soc===null?'Charge level unavailable':`${Math.round(m.soc)}% remaining`);
    text('runtime',m.runtime);
    const meter = this.shadowRoot.querySelector('[role="progressbar"]');
    meter.firstElementChild.style.width = `${m.soc ?? 0}%`;
    if (m.soc===null) { meter.removeAttribute('aria-valuenow'); meter.setAttribute('aria-valuetext','Unavailable'); }
    else { meter.setAttribute('aria-valuenow',String(m.soc)); meter.removeAttribute('aria-valuetext'); }
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
console.info('Powerflow Card __VERSION__');
