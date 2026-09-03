import ipaddress
from functools import lru_cache

from fastapi import Request

from app.config import get_settings


def _parse_ip(value: str | None) -> str | None:
    """Один IP без порта. Мусор и списки заголовков отбрасываем."""
    if not value:
        return None
    raw = value.strip()
    if not raw or "," in raw or " " in raw:
        return None
    if raw.startswith("[") and "]" in raw:
        raw = raw[1 : raw.index("]")]
    else:
        # IPv4:port — ровно одно двоеточие; IPv6 так не режем.
        if raw.count(":") == 1:
            host, _, port = raw.partition(":")
            if port.isdigit():
                raw = host
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return str(addr)


@lru_cache
def _trusted_networks() -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    raw = get_settings().trusted_proxy_ips
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue
    return tuple(nets)


def _is_trusted_peer(host: str | None) -> bool:
    ip = _parse_ip(host)
    if not ip:
        return False
    addr = ipaddress.ip_address(ip)
    return any(addr in net for net in _trusted_networks())


def client_ip(request: Request) -> str | None:
    """IP клиента для аудита.

    Заголовки X-Forwarded-For / X-Real-IP принимаем только если TCP-пир —
    доверенный прокси (nginx). Иначе любой клиент подделал бы логин-аудит.
    """
    peer = request.client.host if request.client else None
    if _is_trusted_peer(peer):
        forwarded = _parse_ip(request.headers.get("x-real-ip"))
        if forwarded:
            return forwarded
    return _parse_ip(peer) or peer
