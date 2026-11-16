export const ENTITY_LABELS = {
  home: 'Home power', solar: 'Solar power', grid_import: 'Grid import power', grid_export: 'Grid export power',
  battery_charge: 'Battery charging power', battery_discharge: 'Battery discharging power', battery_soc: 'Battery percentage',
  battery_runtime: 'Battery hours remaining', backup: 'Backup load power',
  solar_to_home: 'Solar → home', solar_to_battery: 'Solar → battery', solar_to_grid: 'Solar → grid',
  grid_to_home: 'Grid → home', grid_to_battery: 'Grid → battery', battery_to_home: 'Battery → home', battery_to_grid: 'Battery → grid',
  daily_generation: 'Daily generation', daily_import: 'Daily import', daily_export: 'Daily export',
  electricity_cost: 'Net electricity cost today', forecast_tomorrow: 'Tomorrow’s solar forecast',
  charge_start: 'Charge window start', charge_end: 'Charge window end', discharge_start: 'Discharge window start', discharge_end: 'Discharge window end'
};

export function normalizeConfig(config) {
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

export function numberState(state) {
  if (!state || state.state == null || String(state.state).trim() === '' || ['unknown', 'unavailable'].includes(state.state)) return null;
  const n = Number(state.state);
  return Number.isFinite(n) ? n : null;
}

export function scaledState(state, kind) {
  const n = numberState(state);
  if (n === null) return null;
  const unit = state.attributes?.unit_of_measurement;
  const scales = kind === 'energy' ? { Wh: 0.001, kWh: 1, MWh: 1000 } : { W: 1, kW: 1000, MW: 1000000 };
  if (unit && !(unit in scales)) return null;
  return n * (unit ? scales[unit] : 1);
}

export const formatPower = n => n === null ? 'Unavailable' : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)} kW` : `${Math.round(n)} W`;
export const formatEnergy = n => n === null ? 'Unavailable' : `${n.toFixed(1)} kWh`;
export function formatTime(state) {
  const raw = state?.state || '';
  const match = raw.match(/^(?:\d{4}-\d{2}-\d{2}[T ])?([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : 'Unavailable';
}

export function buildModel(config, hass) {
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
