import { ENTITY_LABELS } from './model.js';

export class PowerflowCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    this._form = document.createElement('ha-form');
    this._form.computeLabel = schema => schema.label || schema.name;
    this._form.schema = [
      { name:'title', label:'Title', selector:{text:{}} },
      { name:'entities', label:'Energy sensors (home power is required)', type:'expandable', expanded:true, schema:Object.entries(ENTITY_LABELS).map(([name,label])=>({name,label,required:name==='home',selector:{entity:{}}})) },
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
