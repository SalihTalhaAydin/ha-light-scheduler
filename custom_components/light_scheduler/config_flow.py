"""Config flow for Light Scheduler."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow
from homeassistant.core import callback

from .const import DOMAIN, CONF_PERIODS, CONF_AREA_OVERRIDES


class LightSchedulerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Config flow — creates a single entry."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> dict:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(
                title="Light Scheduler",
                data={CONF_PERIODS: [], CONF_AREA_OVERRIDES: []},
            )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )
