"""شکست سریع شبکه: timeout اتصال کوتاه + قطع‌کننده مدار (circuit breaker) برای هر میزبان.

اگر اتصال به یک میزبان چند بار پشت‌سرهم شکست بخورد (DNS، timeout اتصال/خواندن)،
بقیه درخواست‌های همان چرخه به آن میزبان بلافاصله رد می‌شوند. خطای HTTP (۴xx/۵xx)
میزبان را مسدود نمی‌کند. با `reset()` در ابتدای هر چرخه پاک می‌شود.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

CONNECT_TIMEOUT = 5      # ثانیه؛ سقف زمان برقراری اتصال
FAIL_THRESHOLD = 2       # بعد از این تعداد شکست اتصال، میزبان در این چرخه رد می‌شود

_fails: dict[str, int] = {}
_down: set[str] = set()
_installed = False


class HostDown(requests.exceptions.ConnectionError):
    """میزبان در این چرخه در دسترس نیست (درخواست ارسال نشد)."""


def reset() -> None:
    _fails.clear()
    _down.clear()


def _split_timeout(t):
    if t is None:
        return (CONNECT_TIMEOUT, 20)
    if isinstance(t, tuple):
        return (min(t[0] or CONNECT_TIMEOUT, CONNECT_TIMEOUT), t[1])
    return (min(t, CONNECT_TIMEOUT), t)


def install() -> None:
    """requests.Session.request را یک بار patch می‌کند (همه‌ی requests.get/post را پوشش می‌دهد)."""
    global _installed
    if _installed:
        return
    _installed = True
    orig = requests.Session.request

    def patched(self, method, url, **kw):
        host = urlparse(url).hostname or ""
        if host in _down:
            raise HostDown(f"{host} در این چرخه در دسترس نبود؛ رد شد")
        kw["timeout"] = _split_timeout(kw.get("timeout"))
        try:
            resp = orig(self, method, url, **kw)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            _fails[host] = _fails.get(host, 0) + 1
            if _fails[host] >= FAIL_THRESHOLD:
                _down.add(host)
                log.warning("میزبان %s بعد از %d شکست اتصال برای این چرخه کنار گذاشته شد", host, _fails[host])
            raise
        _fails[host] = 0
        return resp

    requests.Session.request = patched
