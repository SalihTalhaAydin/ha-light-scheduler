# Light Scheduler

A Home Assistant custom integration that automatically sets brightness and color temperature when lights turn on, based on the time of day.

**No more lights blinding you at 2am.** Define time periods — lights that turn on during that period get the right brightness and color temperature automatically. Lights that are off stay off.

## Features

- **Time-based periods** — define brightness and color temp for different parts of the day
- **Sunrise/sunset support** — use `sunrise`, `sunset`, or offsets like `sunset+30m`, `sunrise-1h`
- **Global schedule** — one schedule applies to all lights in your home
- **Area overrides** — override the global schedule for specific rooms (e.g., dimmer in the bedroom)
- **Safe** — never turns lights on or off, only adjusts lights when they are turned on by you or an automation
- **Manual override detection** — if you manually adjust a light, the scheduler backs off until the light is toggled
- **Color temp aware** — only sends color temperature to lights that support it, brightness-only lights get brightness only
- **Periodic updates** — lights that are already on smoothly transition when a period boundary is crossed (e.g., sunset)
- **Sidebar panel UI** — configure everything from the HA sidebar, no YAML
- **HACS compatible** — install via HACS custom repository

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click the three dots (top right) → **Custom repositories**
3. Add `SalihTalhaAydin/ha-light-scheduler` with category **Integration**
4. Search for "Light Scheduler" and install it
5. Restart Home Assistant
6. Go to **Settings → Devices & Services → Add Integration → Light Scheduler**

### Manual

1. Copy `custom_components/light_scheduler` to your HA `custom_components/` directory
2. Restart Home Assistant
3. Go to **Settings → Devices & Services → Add Integration → Light Scheduler**

## Usage

After installation, **Light Scheduler** appears in your HA sidebar.

### Global Schedule

Click **+ Add Period** to define time slots. Each period has:

| Setting | Description |
|---------|-------------|
| **Name** | Label for the period (e.g., "Morning", "Night") |
| **From / To** | Time range — fixed (`22:00`) or sun-based (`sunset`, `sunrise+30m`) |
| **Brightness** | 1–100% |
| **Color Temperature** | 2000K (warm candlelight) – 6500K (cool daylight) |
| **Transition** | Fade duration in seconds |
| **Enabled** | Toggle period on/off without deleting it |

### Example Setup

| Period | From | To | Brightness | Color Temp |
|--------|------|----|------------|------------|
| Morning | `sunrise` | `sunset` | 100% | 5000K |
| Evening | `sunset` | `22:00` | 60% | 3000K |
| Night | `22:00` | `sunrise` | 20% | 2200K |

### Area Overrides

Click **+ Add Area Override** to give a specific room its own schedule. If a light belongs to an area with overrides, those take priority over the global schedule. If the area has no active period at the current time, it falls back to the global schedule.

### Time Formats

| Format | Example | Description |
|--------|---------|-------------|
| Fixed | `22:00` | Specific time |
| Sunrise | `sunrise` | Local sunrise time |
| Sunset | `sunset` | Local sunset time |
| Offset | `sunset+30m` | 30 minutes after sunset |
| Offset | `sunrise-1h` | 1 hour before sunrise |
| Offset | `sunset+1h30m` | 1 hour 30 minutes after sunset |

## How It Works

1. **Light turns ON** → the scheduler checks the current time, finds the active period (area override first, then global), and immediately sets brightness + color temp
2. **Every 60 seconds** → recalculates and updates all currently-on lights, so period transitions (e.g., sunset) are smooth
3. **Manual override** → if you change a light's brightness manually, the scheduler stops managing it until it's toggled off and back on
4. **Light turns OFF** → override flag is cleared, next time it turns on the schedule applies again

The scheduler **never turns lights on or off**. It only adjusts brightness and color temperature of lights that are already on or in the process of turning on.

## WebSocket API

The integration exposes three WebSocket commands:

| Command | Description |
|---------|-------------|
| `light_scheduler/config/get` | Get current periods and area overrides |
| `light_scheduler/config/set` | Update periods and area overrides |
| `light_scheduler/active_period` | Get the currently active global period and area periods |

## License

MIT
