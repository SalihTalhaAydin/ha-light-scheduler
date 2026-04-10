# Light Scheduler

Home Assistant custom integration for time-based light brightness and color temperature control.

## Architecture

- **Backend** (`custom_components/light_scheduler/`)
  - `__init__.py` — Main engine: `LightSchedulerManager` class. Listens for light state changes via `async_track_state_change_event`, applies brightness/color_temp from the active time period. Periodic 60s scan updates ON lights when period boundaries are crossed. WebSocket API for frontend communication.
  - `config_flow.py` — Single-instance config flow. All configuration is done via the sidebar panel, not the config flow UI.
  - `const.py` — Domain name, config keys, defaults.

- **Frontend** (`custom_components/light_scheduler/frontend/`)
  - `panel.js` — Sidebar panel (Web Component). Renders global period table + area override sections. Time picker supports fixed times and sunrise/sunset with offsets. Color temp slider with Kelvin-to-RGB preview.

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
            "enabled": True
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
- **Area lookup**: checks entity registry for area_id, falls back to device's area_id.
- **Color temp safety**: checks `supported_color_modes` before sending `color_temp_kelvin` — brightness-only lights get brightness only.
- **Manual override detection**: if a light's state changes while already ON and it wasn't triggered by the scheduler, the light is marked as overridden. Override clears when the light is turned off.
- **Time resolution**: sunrise/sunset times come from `sun.sun` entity attributes (`next_rising`/`next_setting`). Offsets parsed from strings like `+1h30m`, `-30`.
- **Midnight wrap**: `_in_window()` handles periods crossing midnight (e.g., 22:00 → 06:00).

## WebSocket Commands

| Command | Direction | Purpose |
|---------|-----------|---------|
| `light_scheduler/config/get` | Frontend → Backend | Load periods + area overrides |
| `light_scheduler/config/set` | Frontend → Backend | Save periods + area overrides, restarts manager |
| `light_scheduler/active_period` | Frontend → Backend | Get currently active period (for UI highlighting) |

## Frontend Panel Registration

Panel is registered at URL path `light-scheduler` with static files served from `/light_scheduler/`. The JS file defines `light-scheduler-panel` custom element. Cache busting via `?v=100` query param — bump this on frontend changes.

## Deployment

- Installed via HACS as custom repository: `SalihTalhaAydin/ha-light-scheduler`
- HACS repo ID: `1207364695`
- Domain: `light_scheduler`
- Single instance only (enforced by config flow)
