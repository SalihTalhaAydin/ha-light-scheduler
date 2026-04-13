# Light Scheduler

### Time-Based Light Control for Home Assistant

---

Automatically set brightness and color temperature when lights turn on, based on the time of day. Define time periods with sun-aware scheduling, per-area overrides, and a sidebar UI -- no YAML required.

**No more lights blinding you at 2am.** Lights that turn on during a defined period get the right brightness and color temperature instantly. Lights that are off stay off.

---

## Features

- **Time-Based Periods** -- Define brightness and color temp for different parts of the day
- **Sunrise/Sunset Aware** -- Use `sunrise`, `sunset`, or offsets like `sunset+30m`, `sunrise-1h`
- **Always Active** -- Mark a period as "always on" for a default fallback schedule
- **Global Schedule** -- One schedule applies to all lights in your home
- **Area Overrides** -- Override the global schedule for specific rooms (e.g., dimmer in the bedroom at night)
- **Safe by Design** -- Never turns lights on or off; only adjusts brightness/color when a light is turned on by you or an automation
- **Manual Override Detection** -- Manually adjust a light and the scheduler backs off until the light is toggled off/on
- **Smart Color Temp** -- Only sends color temperature to lights that support it; on/off-only lights are completely ignored
- **Smooth Transitions** -- Lights that are already on transition smoothly when a period boundary is crossed (e.g., sunset)
- **Fast Updates** -- 5-second scan interval catches period transitions quickly
- **Sidebar Panel UI** -- Configure everything from the HA sidebar
- **HACS Compatible** -- Install via HACS custom repository

## Screenshots

> Screenshots coming soon. The panel features a dark-themed UI with time period cards, sunrise/sunset time pickers with offset support, color temperature sliders with Kelvin-to-RGB preview, and area override sections.

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click the three-dot menu (top right) and select **Custom repositories**
3. Add `https://github.com/SalihTalhaAydin/ha-light-scheduler` with category **Integration**
4. Search for "Light Scheduler" and click **Install**
5. Restart Home Assistant
6. Go to **Settings > Devices & Services > Add Integration > Light Scheduler**

### Manual

1. Download or clone this repository
2. Copy `custom_components/light_scheduler` to your Home Assistant `custom_components/` directory
3. Restart Home Assistant
4. Go to **Settings > Devices & Services > Add Integration > Light Scheduler**

## Usage

After installing and adding the integration, **Light Scheduler** appears in your HA sidebar.

### Global Schedule

Click **+ Add Period** to define time slots:

| Setting | Description |
|---------|-------------|
| **Name** | Label for the period (e.g., "Morning", "Night") |
| **Always Active** | Toggle to make this period apply at all times (no time range needed) |
| **From / To** | Time range -- fixed (`22:00`) or sun-based (`sunset`, `sunrise+30m`) |
| **Brightness** | 1--100% |
| **Color Temperature** | 2000K (warm candlelight) -- 6500K (cool daylight) |
| **Transition** | Fade duration in seconds (default: 2s) |
| **Enabled** | Toggle period on/off without deleting it |

### Example Setup

| Period | From | To | Brightness | Color Temp |
|--------|------|----|------------|------------|
| Morning | `sunrise` | `sunset` | 100% | 5000K |
| Evening | `sunset` | `22:00` | 60% | 3000K |
| Night | `22:00` | `sunrise` | 20% | 2200K |

You can also add a **Default** period with "Always Active" as a fallback. Periods are checked top-to-bottom; the first match wins. Put specific time periods first and the always-active fallback last.

### Area Overrides

Click **+ Add Area Override** to give a specific room its own schedule. If a light belongs to an area with overrides, those take priority over the global schedule. If the area has no active period at the current time, it falls back to the global schedule.

Use this for rooms that need different behavior:
- **Son's bedroom**: 5% brightness, 2200K after 8pm
- **Office**: 100% brightness all day regardless of time
- **Bathroom**: 30% at night, 100% during the day

### Time Formats

| Format | Example | Description |
|--------|---------|-------------|
| Fixed time | `22:00` | Specific time (24-hour format) |
| Sunrise | `sunrise` | At sunrise |
| Sunset | `sunset` | At sunset |
| Sunrise + offset | `sunrise+30m` | 30 minutes after sunrise |
| Sunset - offset | `sunset-1h30m` | 1 hour 30 minutes before sunset |
| Offset (hours only) | `sunset+2h` | 2 hours after sunset |
| Offset (minutes only) | `sunrise-45m` | 45 minutes before sunrise |

Time windows wrap around midnight. For example, `from: "22:00"` and `to: "sunrise"` means "from 10pm to the next sunrise."

## How It Works

1. **Light turns ON** -- The scheduler checks the current time, finds the active period (area override first, then global), and immediately sets brightness + color temp
2. **Every 5 seconds** -- Recalculates and updates all currently-on lights so period transitions (e.g., sunset) are smooth
3. **Manual override** -- If you change a light's brightness manually (via app, physical switch, etc.), the scheduler stops managing it until the light is toggled off and back on
4. **Light turns OFF** -- Override flag is cleared; next time it turns on, the schedule applies again
5. **On/off-only lights** -- Lights that don't support dimming (only `onoff` color mode) are completely ignored. No service calls are sent to them.

The scheduler **never turns lights on or off**. It only adjusts brightness and color temperature of lights that are already on or in the process of turning on.

## Configuration Reference

### Period Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the period |
| `always` | boolean | If true, period is always active (ignores from/to) |
| `from_time` | string | Start time (see time formats above) |
| `to_time` | string | End time (see time formats above) |
| `brightness` | number | Brightness percentage (1--100) |
| `color_temp` | number | Color temperature in Kelvin (2000--6500) |
| `transition` | number | Transition duration in seconds (default: 2) |
| `enabled` | boolean | Whether the period is active |

### Area Override Fields

| Field | Type | Description |
|-------|------|-------------|
| `area_id` | string | HA area ID |
| `periods` | array | List of periods (same structure as global) |

## WebSocket API

| Command | Description |
|---------|-------------|
| `light_scheduler/config/get` | Get current periods and area overrides |
| `light_scheduler/config/set` | Update periods and area overrides (restarts the manager) |
| `light_scheduler/active_period` | Get the currently active global and area-specific periods |

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test with a real HA instance
5. Submit a pull request

## License

MIT License. See [LICENSE](LICENSE) for details.

---

Built for any smart light ecosystem. Works with Zigbee, Z-Wave, WiFi, and any light entity in Home Assistant.
