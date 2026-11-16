# Powerflow Card

A standalone Home Assistant Lovelace card for solar, grid, battery and home energy. Battery percentage is displayed **inside the battery node**, alongside charging/discharging power and status. There is no duplicate battery bar; the optional runtime estimate sits below the flow diagram.

No Button-Card, card-mod, external fonts, CDNs or other frontend dependencies are required. The card does not call services or change inverter settings. Selecting a node opens Home Assistant's entity history/details.

## Install through HACS

1. In HACS, open the menu → **Custom repositories**.
2. Add `https://github.com/OneScuzzie2k/powerflow-card` with type **Dashboard**.
3. Find **Powerflow Card** in HACS and download it.
4. Reload your browser. Add **Powerflow Card** using the dashboard card picker and select your entities.

If HACS does not add the resource automatically, add `/hacsfiles/powerflow-card/powerflow-card.js` as a **JavaScript module** under Settings → Dashboards → Resources. Enable advanced mode in your profile if Resources is hidden.

This is a HACS custom repository; inclusion in the default HACS catalogue is a separate process.

## Manual installation

Copy `dist/powerflow-card.js` to `/config/www/powerflow-card.js`. Register `/local/powerflow-card.js` as a JavaScript module, then reload your browser.

## Configuration

```yaml
type: custom:powerflow-card
title: Power at a glance
entities:
  home: sensor.home_power
  solar: sensor.solar_power
  grid_import: sensor.grid_import_power
  grid_export: sensor.grid_export_power
  battery_charge: sensor.battery_charge_power
  battery_discharge: sensor.battery_discharge_power
  battery_soc: sensor.battery_percentage
  battery_runtime: sensor.battery_hours_remaining
  solar_to_home: sensor.solar_to_home
  solar_to_battery: sensor.solar_to_battery
  solar_to_grid: sensor.solar_to_grid
  grid_to_home: sensor.grid_to_home
  grid_to_battery: sensor.grid_to_battery
  battery_to_home: sensor.battery_to_home
  battery_to_grid: sensor.battery_to_grid
```

Only `entities.home` is required. The visual editor offers all supported sensor fields. Omitted nodes and optional sections are hidden. Configured sensors that are missing or unavailable are labelled explicitly instead of being shown as zero.

Use **positive, directional power sensors** for import/export and charge/discharge. Power supports W, kW and MW (unitless values are treated as W). A signed net sensor must first be split into positive directional sensors using Home Assistant helpers/templates.

Flow lines use the seven explicit route sensors above. They animate toward the destination, speed up with power, and disappear below the threshold. Routes are never guessed from totals: if you omit a route sensor, that line is hidden. Configured endpoint power sensors must agree that the source and destination are active; this reduces contradictory lines while independently updated helpers catch up.

Additional entity mappings:

| Entity key | Purpose / expected unit |
| --- | --- |
| `battery_soc` | Charge level, 0–100% |
| `battery_runtime` | Existing runtime estimate, hours (also accepts min or s) |
| `backup` | Backup load power |
| `daily_generation`, `daily_import`, `daily_export` | Daily energy, Wh / kWh / MWh; unitless assumes kWh |
| `electricity_cost` | Your existing net electricity cost sensor, currency units; p / GBp is converted to pounds |
| `forecast_tomorrow` | Tomorrow's solar forecast, Wh / kWh / MWh |
| `charge_start`, `charge_end` | Inverter charge window, time or input_datetime entities |
| `discharge_start`, `discharge_end` | Inverter discharge window |

Runtime is displayed only while discharging. The card displays the estimate from your sensor; it does not invent a battery capacity or calculate a new runtime. Schedule fields are read-only.

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | Power at a glance | Card heading |
| `flow_threshold` | 50 | Minimum active power in W |
| `currency` | Home Assistant currency, otherwise GBP | Three-letter currency code |
| `show_daily` | true | Show configured daily energy totals |
| `show_forecast` | true | Show tomorrow's forecast |
| `show_schedule` | true | Show configured charge/discharge windows |

See [examples/solarman.yaml](examples/solarman.yaml) for the complete Solarman mapping. Replace entity IDs with those on your installation. Themes and reduced-motion preferences are respected. Both masonry and sections views are supported.

## Development and releases

Requires Node 20 or later. There are no package dependencies to install.

```sh
npm test
npm run build
npm run check
```

`src/` contains the model, native web component, visual editor and styling. The build produces a single self-contained `dist/powerflow-card.js`; commit the built file so HACS can install from the default branch. To publish a release, update the package version, rebuild, commit, and push a matching `vX.Y.Z` tag. The release workflow tests the card and attaches the JavaScript file to the GitHub release.

Repository name must remain `powerflow-card` (or `lovelace-powerflow-card`) so HACS can locate the matching JavaScript filename.

## References

- [Home Assistant custom card API](https://contributors.home-assistant.io/frontend/custom-ui/card/)
- [HACS dashboard repository requirements](https://www.hacs.xyz/docs/publish/plugin/)

MIT licensed.
