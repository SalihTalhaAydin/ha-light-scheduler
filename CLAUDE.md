# Light Scheduler

Home Assistant custom integration for time-based light brightness and color temperature control.

## Architecture

- **Backend** (`custom_components/light_scheduler/`)
  - `__init__.py` — Main engine: `LightSchedulerManager` class. Listens for all state changes via `hass.bus.async_listen(EVENT_STATE_CHANGED)`, filters for `light.*` entities, applies brightness/color_temp from the active time period. Periodic 5s scan updates ON lights when period boundaries are crossed. WebSocket API for frontend communication.
  - `config_flow.py` — Single-instance config flow. All configuration is done via the sidebar panel, not the config flow UI.
  - `const.py` — Domain name, config keys, defaults.

- **Frontend** (`custom_components/light_scheduler/frontend/`)
  - `panel.js` — Sidebar panel (Web Component). Renders global period table + area override sections. Time picker supports fixed times and sunrise/sunset with offsets. Color temp slider with Kelvin-to-RGB preview. "Always active" toggle per period.

## Data Model

Config is stored in the HA config entry's `data` dict:

```python
{
    "periods": [
        {
            "name": "Evening",
            "from_time": "sunset",      # or "22:00", "sunrise+30m"
            "to_time": "22:00",
            "brightness": 60,           # percentage (0-100)
            "color_temp": 3000,         # Kelvin
            "transition": 2,            # seconds
            "enabled": True,
            "always": False             # if True, from/to are ignored
        }
    ],
    "area_overrides": [
        {
            "area_id": "bedroom",
            "periods": [...]            # same structure as global periods
        }
    ]
}
```

## Key Behaviors

- **Never turns lights on or off** — only adjusts brightness/color_temp when a light is already on or turning on.
- **On/off-only lights are ignored** — checks `supported_color_modes` before sending brightness. Lights with only `onoff` mode get zero service calls, preventing them from being kept on.
- **Area lookup**: checks entity registry for area_id, falls back to device's area_id.
- **Color temp safety**: checks `supported_color_modes` before sending `color_temp_kelvin` — brightness-only lights get brightness only.
- **Manual override detection**: Uses tracked `Context` objects on service calls. If a light's state changes while already ON and the context doesn't match one of our calls, the light is marked as overridden. Override clears when the light is turned off.
- **Context tracking**: `_our_contexts` set holds context IDs from our `light.turn_on` calls. Capped at 100 entries to prevent unbounded growth.
- **State listener**: Uses `hass.bus.async_listen(EVENT_STATE_CHANGED)` instead of `async_track_state_change_event([])` — the latter tracks nothing when given an empty list.
- **Dedup check**: Before sending a service call, compares current brightness (tolerance: 3/255) and color_temp (tolerance: 50K) to target. Skips if already matching.
- **Double state check**: `_apply_to_light()` re-reads the light's state before sending commands, preventing race conditions where a light was turned off between the periodic scan and the service call.
- **Time resolution**: sunrise/sunset times come from `sun.sun` entity attributes (`next_rising`/`next_setting`). Offsets parsed from strings like `+1h30m`, `-30`.
- **Midnight wrap**: `_in_window()` handles periods crossing midnight (e.g., 22:00 → 06:00).
- **"Always" periods**: Periods with `always: True` match at any time, useful as fallback defaults.

## WebSocket Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `light_scheduler/config/get` | Frontend → Backend | Load periods + area overrides |
| `light_scheduler/config/set` | Frontend → Backend | Save periods + area overrides, restarts manager |
| `light_scheduler/active_period` | Frontend → Backend | Get currently active period (for UI highlighting) |

## Frontend Panel Registration

Panel is registered at URL path `light-scheduler` with static files served from `/light_scheduler/`. The JS file defines `light-scheduler-panel` custom element. Cache busting via `?v=101` query param — bump this on frontend changes.

## Deployment

- Installed via HACS as custom repository: `SalihTalhaAydin/ha-light-scheduler`
- HACS repo ID: `1207364695`
- Domain: `light_scheduler`
- Single instance only (enforced by config flow)
