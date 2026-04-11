"""Light Scheduler — Time-based brightness & color temperature control."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from pathlib import Path

import voluptuous as vol
import homeassistant.util.dt as dt_util

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON
from homeassistant.core import HomeAssistant, callback, Event
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)

from .const import (
    DOMAIN,
    CONF_PERIODS,
    CONF_AREA_OVERRIDES,
    CONF_FROM_TIME,
    CONF_TO_TIME,
    CONF_BRIGHTNESS,
    CONF_COLOR_TEMP,
    CONF_ENABLED,
    CONF_AREA_ID,
    CONF_TRANSITION,
    DEFAULT_TRANSITION,
    SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)
FE = Path(__file__).parent / "frontend"


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    """Set up Light Scheduler."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(
            "/light_scheduler", str(FE),
            cache_headers=False,
        )]
    )

    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Light Scheduler",
        sidebar_icon="mdi:lightbulb-auto",
        frontend_url_path="light-scheduler",
        config={"_panel_custom": {
            "name": "light-scheduler-panel",
            "module_url": "/light_scheduler/panel.js?v=101",
        }},
        require_admin=False,
    )

    if "ls_ws" not in hass.data:
        hass.data["ls_ws"] = True
        websocket_api.async_register_command(
            hass, "light_scheduler/config/get",
            _ws_get, _WS_GET,
        )
        websocket_api.async_register_command(
            hass, "light_scheduler/config/set",
            _ws_set, _WS_SET,
        )
        websocket_api.async_register_command(
            hass, "light_scheduler/active_period",
            _ws_active, _WS_ACTIVE,
        )

    mgr = LightSchedulerManager(hass, entry)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = mgr
    await mgr.async_start()
    entry.async_on_unload(
        entry.add_update_listener(_on_update)
    )
    return True


# ── WebSocket schemas ──

_WS_GET = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {vol.Required("type"): "light_scheduler/config/get"}
)

_WS_SET = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {
        vol.Required("type"): "light_scheduler/config/set",
        vol.Required("periods"): list,
        vol.Required("area_overrides"): list,
    }
)

_WS_ACTIVE = websocket_api.BASE_COMMAND_MESSAGE_SCHEMA.extend(
    {vol.Required("type"): "light_scheduler/active_period"}
)


# ── WebSocket handlers ──

@callback
def _ws_get(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    periods, overrides = [], []
    if entries:
        periods = entries[0].data.get(CONF_PERIODS, [])
        overrides = entries[0].data.get(CONF_AREA_OVERRIDES, [])
    conn.send_result(msg["id"], {
        "periods": periods,
        "area_overrides": overrides,
    })


@callback
def _ws_set(hass, conn, msg):
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        conn.send_error(msg["id"], "not_found", "")
        return
    entry = entries[0]
    new_data = dict(entry.data)
    new_data[CONF_PERIODS] = msg["periods"]
    new_data[CONF_AREA_OVERRIDES] = msg["area_overrides"]
    hass.config_entries.async_update_entry(entry, data=new_data)
    mgr = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if mgr:
        mgr.async_stop()
        hass.async_create_task(mgr.async_start())
    conn.send_result(msg["id"], {"success": True})


@callback
def _ws_active(hass, conn, msg):
    """Return the currently active global period and any area overrides."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        conn.send_result(msg["id"], {"global": None, "areas": {}})
        return
    mgr = hass.data.get(DOMAIN, {}).get(entries[0].entry_id)
    if not mgr:
        conn.send_result(msg["id"], {"global": None, "areas": {}})
        return
    now = dt_util.now()
    global_period = mgr._find_active_period(
        entries[0].data.get(CONF_PERIODS, []), now
    )
    area_periods = {}
    for ov in entries[0].data.get(CONF_AREA_OVERRIDES, []):
        ap = mgr._find_active_period(ov.get(CONF_PERIODS, []), now)
        if ap:
            area_periods[ov[CONF_AREA_ID]] = ap
    conn.send_result(msg["id"], {
        "global": global_period,
        "areas": area_periods,
    })


async def async_unload_entry(
    hass: HomeAssistant, entry: ConfigEntry
) -> bool:
    mgr = hass.data[DOMAIN].pop(entry.entry_id, None)
    if mgr:
        mgr.async_stop()
    frontend.async_remove_panel(hass, "light-scheduler")
    return True


async def _on_update(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    mgr = hass.data[DOMAIN].get(entry.entry_id)
    if mgr:
        mgr.async_stop()
        await mgr.async_start()


class LightSchedulerManager:
    """Manages time-based light brightness and color temperature."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry):
        self.hass = hass
        self.entry = entry
        self._unsubs: list = []
        # Track which lights were manually overridden — skip them
        # until they are toggled off and back on.
        self._overridden: set[str] = set()

    def _periods(self) -> list[dict]:
        return self.entry.data.get(CONF_PERIODS, [])

    def _area_overrides(self) -> list[dict]:
        return self.entry.data.get(CONF_AREA_OVERRIDES, [])

    async def async_start(self):
        """Start listening for light changes and periodic updates."""
        # Listen for ANY light turning on
        self._unsubs.append(
            async_track_state_change_event(
                self.hass,
                [],  # empty = all entities
                self._on_state_change,
            )
        )

        # Periodic scan to update lights when a time boundary is crossed
        self._unsubs.append(
            async_track_time_interval(
                self.hass,
                self._periodic_update,
                timedelta(seconds=SCAN_INTERVAL),
            )
        )

        _LOGGER.info(
            "Light Scheduler started: %d periods, %d area overrides",
            len(self._periods()),
            len(self._area_overrides()),
        )

    @callback
    def async_stop(self):
        for u in self._unsubs:
            u()
        self._unsubs.clear()
        self._overridden.clear()

    @callback
    def _on_state_change(self, event: Event):
        """Handle any entity state change — we only care about lights turning on/off."""
        eid = event.data["entity_id"]
        if not eid.startswith("light."):
            return

        ns = event.data.get("new_state")
        os = event.data.get("old_state")
        if not ns:
            return

        # Light turned off — clear override flag
        if ns.state != STATE_ON:
            self._overridden.discard(eid)
            return

        # Light just turned on (from off or unavailable)
        if os and os.state == STATE_ON:
            # State changed while already on — might be a manual brightness change.
            # Check if this was triggered by us (via context).
            if ns.context and ns.context.parent_id:
                # This change was triggered by our service call — ignore
                return
            # Manual change — mark as overridden
            self._overridden.add(eid)
            _LOGGER.debug("Manual override detected: %s", eid)
            return

        # Light turned on from off — apply schedule
        self._overridden.discard(eid)
        self.hass.async_create_task(
            self._apply_to_light(eid)
        )

    async def _periodic_update(self, now=None):
        """Periodically apply current period settings to all on lights."""
        states = self.hass.states.async_all("light")
        for state in states:
            if state.state != STATE_ON:
                continue
            if state.entity_id in self._overridden:
                continue
            await self._apply_to_light(state.entity_id)

    async def _apply_to_light(self, entity_id: str):
        """Apply the active period's brightness/color_temp to a single light."""
        # Re-check the light is still ON right now — it may have been
        # turned off between the time we queued this call and now.
        current = self.hass.states.get(entity_id)
        if not current or current.state != STATE_ON:
            return

        now = dt_util.now()

        # Check area overrides first
        area_id = self._get_light_area(entity_id)
        period = None

        if area_id:
            for ov in self._area_overrides():
                if ov.get(CONF_AREA_ID) == area_id:
                    period = self._find_active_period(
                        ov.get(CONF_PERIODS, []), now
                    )
                    break

        # Fall back to global periods
        if period is None:
            period = self._find_active_period(self._periods(), now)

        if period is None:
            return  # No active period — don't touch the light

        # Build service data
        data: dict = {"entity_id": entity_id}

        # Check what this light actually supports
        state = self.hass.states.get(entity_id)
        color_modes = (
            state.attributes.get("supported_color_modes", [])
            if state else []
        )

        # If light only supports on/off, don't send brightness
        # or color_temp — there's nothing to adjust.
        supports_brightness = any(
            m in color_modes
            for m in ("brightness", "color_temp", "ct", "hs",
                      "xy", "rgb", "rgbw", "rgbww")
        )

        brightness = period.get(CONF_BRIGHTNESS)
        if (brightness is not None and brightness != ""
                and supports_brightness):
            # brightness_pct (0-100) → convert to HA brightness (0-255)
            data["brightness"] = round(int(brightness) * 255 / 100)

        color_temp = period.get(CONF_COLOR_TEMP)
        if color_temp is not None and color_temp != "":
            if "color_temp" in color_modes or "ct" in color_modes:
                data["color_temp_kelvin"] = int(color_temp)

        transition = period.get(CONF_TRANSITION)
        if transition is not None and transition != "":
            data["transition"] = int(transition)
        else:
            data["transition"] = DEFAULT_TRANSITION

        if len(data) <= 2:
            # Only entity_id and transition — nothing to set
            return

        # Re-check light is still ON before sending any command
        state = self.hass.states.get(entity_id)
        if not state or state.state != STATE_ON:
            return

        # Skip if the light already matches the target values
        attrs = state.attributes
        needs_update = False

        target_bright = data.get("brightness")
        if target_bright is not None:
            current_bright = attrs.get("brightness")
            # Allow tolerance of 3 (out of 255) for rounding
            if (current_bright is None
                    or abs(current_bright - target_bright) > 3):
                needs_update = True

        target_ct = data.get("color_temp_kelvin")
        if target_ct is not None:
            current_ct = attrs.get("color_temp_kelvin")
            # Allow tolerance of 50K for rounding
            if current_ct is None or abs(current_ct - target_ct) > 50:
                needs_update = True

        if not needs_update:
            return

        _LOGGER.debug(
            "Applying to %s: brightness=%s, color_temp=%s",
            entity_id,
            data.get("brightness"),
            data.get("color_temp_kelvin"),
        )

        await self.hass.services.async_call(
            "light", "turn_on", data,
        )

    def _get_light_area(self, entity_id: str) -> str | None:
        """Look up which area a light belongs to via the entity registry."""
        ent_reg = self.hass.data.get("entity_registry")
        if not ent_reg:
            try:
                from homeassistant.helpers.entity_registry import async_get
                ent_reg = async_get(self.hass)
            except Exception:
                return None
        entry = ent_reg.async_get(entity_id)
        if not entry:
            return None
        if entry.area_id:
            return entry.area_id
        # Check device area
        if entry.device_id:
            dev_reg = self.hass.data.get("device_registry")
            if not dev_reg:
                try:
                    from homeassistant.helpers.device_registry import async_get
                    dev_reg = async_get(self.hass)
                except Exception:
                    return None
            device = dev_reg.async_get(entry.device_id)
            if device and device.area_id:
                return device.area_id
        return None

    def _find_active_period(
        self, periods: list[dict], now: datetime
    ) -> dict | None:
        """Find the currently active period from a list of periods."""
        for p in periods:
            if not p.get(CONF_ENABLED, True):
                continue
            # "Always" period — no time restrictions
            if p.get("always", False):
                return p
            from_str = p.get(CONF_FROM_TIME, "")
            to_str = p.get(CONF_TO_TIME, "")
            if not from_str or not to_str:
                continue
            from_time = self._resolve_time(from_str, now)
            to_time = self._resolve_time(to_str, now)
            if from_time is None or to_time is None:
                continue
            if self._in_window(now, from_time, to_time):
                return p
        return None

    def _in_window(
        self, now: datetime, start: datetime, end: datetime
    ) -> bool:
        """Check if now is within [start, end), handling midnight wrap."""
        if start <= end:
            return start <= now < end
        # Wraps midnight (e.g., 22:00 → 06:00)
        return now >= start or now < end

    def _resolve_time(self, t: str, now: datetime):
        """Parse a time string: 'HH:MM', 'sunrise', 'sunset+30', 'sunset-1h30m', etc."""
        if not t:
            return None
        t = t.strip().lower()

        if t.startswith("sunrise") or t.startswith("sunset"):
            sun = self.hass.states.get("sun.sun")
            if not sun:
                return None
            kind = "sunrise" if t.startswith("sunrise") else "sunset"
            attr = "next_rising" if kind == "sunrise" else "next_setting"
            raw = sun.attributes.get(attr)
            if not raw:
                return None
            sun_dt = dt_util.parse_datetime(raw)
            if not sun_dt:
                return None
            local = dt_util.as_local(sun_dt)
            target = now.replace(
                hour=local.hour, minute=local.minute,
                second=0, microsecond=0,
            )
            rest = t[len(kind):]
            off = self._parse_offset(rest)
            if off is not None:
                target += timedelta(minutes=off)
            return target

        # Fixed time HH:MM
        try:
            parts = t.split(":")
            h, m = int(parts[0]), int(parts[1])
            return now.replace(
                hour=h, minute=m, second=0, microsecond=0,
            )
        except (ValueError, IndexError):
            return None

    def _parse_offset(self, s: str) -> int | None:
        """Parse offset like '+30', '-1h30m', '+2h'."""
        if not s:
            return None
        sign = 1
        if s[0] == "-":
            sign = -1
            s = s[1:]
        elif s[0] == "+":
            s = s[1:]
        if not s:
            return None
        total = 0
        has_unit = False
        buf = ""
        for ch in s:
            if ch.isdigit():
                buf += ch
            elif ch == "h":
                if buf:
                    total += int(buf) * 60
                    has_unit = True
                    buf = ""
            elif ch == "m":
                if buf:
                    total += int(buf)
                    has_unit = True
                    buf = ""
            else:
                return None
        if buf:
            if has_unit:
                return None
            total = int(buf)
        return sign * total
