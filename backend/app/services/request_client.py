from fastapi import Request


def client_ip(request: Request) -> str | None:
    xf = request.headers.get("x-forwarded-for")
    if xf:
        return xf.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None
