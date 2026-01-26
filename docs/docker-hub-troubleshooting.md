# Docker Hub troubleshooting (DNS/registry)

These steps help verify if Docker Hub and npm registry are reachable from the host.

## 1) Check DNS resolver
```bash
cat /etc/resolv.conf
```
Example output when the resolver is set:
```
nameserver 172.31.0.147
```

## 2) Resolve Docker Hub auth endpoint
```bash
getent hosts auth.docker.io
```
Example output (IPv6 shown here):
```
2600:1f18:2148:bc01:4b51:6c17:6faa:3cf2 auth.docker.io
```

## 3) Fetch a token from Docker Hub
```bash
curl -s "https://auth.docker.io/token?scope=repository:library/node:pull&service=registry.docker.io" | head -c 200
```
Example output (token JSON is expected):
```
{"token":"eyJhbGciOi..."}
```

If DNS resolution fails (`EAI_AGAIN` or `lookup auth.docker.io`), fix the DNS resolver first:
- Update `/etc/resolv.conf` to use a working resolver (e.g. `1.1.1.1` or `8.8.8.8`).
- For Docker Desktop/daemon, set DNS servers in the daemon config (e.g. `/etc/docker/daemon.json`).

If the token fetch works but Docker still fails, verify:
- Outbound HTTPS (443) is allowed to `auth.docker.io` and `registry-1.docker.io`.
- Any corporate proxy is configured in the Docker daemon.
