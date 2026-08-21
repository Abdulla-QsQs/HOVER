# HOVER push scheduler

This small Cloudflare Worker calls HOVER Mobile's protected notification dispatcher every minute. It contains no user data and cannot read reminder records directly.

`SCHEDULER_SECRET` is configured as a Cloudflare secret and must match the secret stored in HOVER Mobile's Sites environment. The public worker configuration contains only the HOVER Mobile production URL.
