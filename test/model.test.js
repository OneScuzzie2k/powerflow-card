import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, numberState, scaledState, buildModel, formatTime } from '../src/model.js';
const state = (value, unit='W')=>({state:String(value),attributes:{unit_of_measurement:unit}});
const config = normalizeConfig({entities:{home:'sensor.home',solar:'sensor.solar',grid_import:'sensor.gi',grid_export:'sensor.go',battery_charge:'sensor.bi',battery_discharge:'sensor.bo',battery_soc:'sensor.soc',battery_runtime:'sensor.hours',solar_to_home:'sensor.sh',battery_to_grid:'sensor.bg',grid_to_battery:'sensor.gb',daily_generation:'sensor.daily',electricity_cost:'sensor.cost'}});
const fixture = ()=>({states:{'sensor.home':state(2696),'sensor.solar':state(594),'sensor.gi':state(419),'sensor.go':state(0),'sensor.bi':state(0),'sensor.bo':state(1683),'sensor.soc':state(60,'%'),'sensor.hours':state(4.4,'h'),'sensor.sh':state(594),'sensor.bg':state(200),'sensor.gb':state(0),'sensor.daily':state(8200,'Wh'),'sensor.cost':state(2.01,'GBP')},config:{currency:'GBP'},locale:{language:'en-GB'}});
test('validates required entities, threshold, switches and currency',()=>{
  assert.throws(()=>normalizeConfig({}),/entities/);
  assert.throws(()=>normalizeConfig({entities:{}}),/home/);
  assert.throws(()=>normalizeConfig({entities:{home:'<script>'}}),/Invalid/);
  for(const flow_threshold of [-1,NaN,'50']) assert.throws(()=>normalizeConfig({entities:{home:'sensor.home'},flow_threshold}),/threshold/);
  assert.throws(()=>normalizeConfig({entities:{home:'sensor.home'},show_daily:'false'}),/true or false/);
  assert.throws(()=>normalizeConfig({entities:{home:'sensor.home'},currency:'£'}),/currency/);
});
test('normalises power and energy units without treating unavailable data as zero',()=>{
  assert.equal(scaledState(state(.594,'kW'),'power'),594);
  assert.equal(scaledState(state(8200,'Wh'),'energy'),8.2);
  assert.equal(scaledState(state(1.2,'MWh'),'energy'),1200);
  assert.equal(scaledState(state(3,'A'),'power'),null);
  for(const raw of ['','unknown','unavailable','NaN','Infinity']) assert.equal(numberState(state(raw)),null);
});
test('mixed sources, percentage, runtime, daily energy and cost',()=>{
  const m=buildModel(config,fixture());
  assert.equal(m.summary,'Solar + battery + grid supplying power');
  assert.equal(m.soc,60);assert.equal(m.runtime,'~4.4 h estimated');
  assert.equal(m.energy.daily_generation,'8.2 kWh');assert.equal(m.cost,'£2.01');
  assert.equal(m.flows.solar_to_home,594);
});
test('inactive or inconsistent endpoints suppress stale export and charging lines',()=>{
  const h=fixture();
  assert.equal(buildModel(config,h).flows.battery_to_grid,0);
  h.states['sensor.go']=state(200);
  assert.equal(buildModel(config,h).flows.battery_to_grid,200);
  h.states['sensor.bo']=state(0);
  assert.equal(buildModel(config,h).flows.battery_to_grid,0);
  h.states['sensor.gb']=state(500);
  assert.equal(buildModel(config,h).flows.grid_to_battery,0);
  h.states['sensor.bi']=state(500);
  assert.equal(buildModel(config,h).flows.grid_to_battery,500);
  assert.equal(buildModel(config,h).runtime,'Charging');
});
test('missing sensors and invalid percentage are explicit; zero percentage is valid',()=>{
  const h=fixture();h.states['sensor.soc']=state(0,'%');assert.equal(buildModel(config,h).soc,0);
  h.states['sensor.soc']=state(120,'%');assert.equal(buildModel(config,h).soc,null);
  const m=buildModel(config,{states:{}});assert.equal(m.missing,true);assert.equal(m.gridValue,null);assert.equal(m.soc,null);
  assert.match(m.summary,/unavailable/);
});
test('only configured sensors affect missing-data status and no flows are invented',()=>{
  const c=normalizeConfig({entities:{home:'sensor.home'}});
  const m=buildModel(c,{states:{'sensor.home':state(100)}});
  assert.equal(m.missing,false);assert.ok(Object.values(m.flows).every(w=>w===0));
});
test('minute runtime, pence costs and schedule times',()=>{
  const h=fixture();h.states['sensor.hours']=state(90,'min');h.states['sensor.cost']=state(201,'p');
  const m=buildModel(config,h);assert.equal(m.runtime,'~1.5 h estimated');assert.equal(m.cost,'£2.01');
  assert.equal(formatTime(state('00:00:00','')), '00:00');assert.equal(formatTime(state('2026-11-16 21:30:00','')), '21:30');
  assert.equal(formatTime(state('25:30:00','')), 'Unavailable');
});
