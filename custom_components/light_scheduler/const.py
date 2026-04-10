"""Constants for Light Scheduler."""

DOMAIN = "light_scheduler"

CONF_PERIODS = "periods"
CONF_AREA_OVERRIDES = "area_overrides"

CONF_FROM_TIME = "from_time"
CONF_TO_TIME = "to_time"
CONF_BRIGHTNESS = "brightness"
CONF_COLOR_TEMP = "color_temp"
CONF_ENABLED = "enabled"
CONF_NAME = "name"
CONF_AREA_ID = "area_id"
CONF_TRANSITION = "transition"

DEFAULT_TRANSITION = 2  # seconds
SCAN_INTERVAL = 60  # seconds — how often to re-check sun position and update lights
