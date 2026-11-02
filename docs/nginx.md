# nginx

[Docs home](README.md) · [Architecture](structure.md) · [Development](development.md) · [Deployment](deployment.md) · [nginx](nginx.md) · [Operations](operations.md) · [Data analysis](data-analysis.md) · [Project README](../README.md)

- [Configuration](#configuration)
- [Database port (5432)](#database-port-5432)
- [Applying changes](#applying-changes)

## Configuration

nginx was set up by DTU before this project, in `/etc/nginx/conf.d/psqdb.conf`, together
with the certificate (`/etc/nginx/conf.d/ssl-compute.dtu.dk.conf`). It is not part of this
repository and the scripts never touch it. This is the version it should contain:

```nginx
# Only the two login URLs get a key, so nothing else is limited.
map $request_uri $login_limit_key {
    ~^/(api/csrf|admin/login)/  $binary_remote_addr;
    default                     "";
}
limit_req_zone $login_limit_key zone=login:1m rate=10r/m;

server {
    listen 80;
    listen [::]:80;
    server_name psqdb.compute.dtu.dk;
    return 301 https://$host$request_uri;
}

server {
    listen       443 ssl;
    listen       [::]:443 ssl;
    http2        on;
    server_name  psqdb.compute.dtu.dk;
    root         /usr/share/nginx/html;

    include /etc/nginx/conf.d/ssl-compute.dtu.dk.conf;

    client_max_body_size 100M;

    location / {
        limit_req zone=login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:2810;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    error_page 404 /404.html;
    location = /40x.html {
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
    }
}
```

What it does:

- **Port 80** redirects to HTTPS. The site never works over plain HTTP, because the session
  cookie is HTTPS-only, and the supporter password must not travel unencrypted.
- **Port 443** forwards every request to gunicorn on `127.0.0.1:2810`. Django serves the API,
  the admin, `/static/` and the frontend, so nginx serves none of this project's files.
- `proxy_pass` uses `127.0.0.1`, not `localhost`: `localhost` can resolve to `::1` first, and
  gunicorn only listens on `127.0.0.1`, so nginx would log a failed connection to `[::1]:2810`
  before falling back.
- `proxy_set_header Host $host` passes on the real host name. Without it, nginx sends
  `Host: 127.0.0.1:2810`, and Django answers `400 Bad Request`, because only
  `psqdb.compute.dtu.dk` is in `ALLOWED_HOSTS`.
- `proxy_set_header X-Forwarded-Proto $scheme` tells Django the request arrived over HTTPS
  (`SECURE_PROXY_SSL_HEADER` in `settings.py`).
- `limit_req` slows password guessing: each address gets 10 requests a minute to
  `/api/csrf/` (the supporter login) and `/admin/login/`, plus a burst of 5. Requests over
  the limit get `429` and never reach Django. Supporters log in once a day, so they don't
  notice it. `map` and `limit_req_zone` sit outside the `server` blocks because nginx only
  allows them there; files in `conf.d/` are included inside the `http` block, so this works.
- `root /usr/share/nginx/html` and the `error_page` lines are for nginx's own error pages,
  such as `50x.html` when gunicorn is down.
- `error_page 404 /404.html` points to `/404.html`, but the `location` below it is `/40x.html`.
  This changes nothing in practice: nginx only uses `error_page` for errors it produces itself,
  and 404s come from Django.

## Database port (5432)

Notebooks on analysts' machines reach PostgreSQL through nginx too, over TLS on port 5432
(see [Data analysis](data-analysis.md#connecting-from-a-notebook)). This is a `stream` block,
outside the web server's `http` block. In `/etc/nginx/nginx.conf`:

```nginx
stream {
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Postgres sees every client as 127.0.0.1, so log the real IPs here
    log_format pgproxy '$remote_addr [$time_local] $protocol $status '
                       'sent=$bytes_sent recv=$bytes_received '
                       'time=$session_time upstream="$upstream_addr"';
    access_log /var/log/nginx/postgres-stream.log pgproxy;

    include /etc/nginx/stream.d/*.conf;
}
```

And `/etc/nginx/stream.d/postgres.conf`:

```nginx
upstream postgres_local {
    server 127.0.0.1:5432;
}

# Direct TLS (libpq 17+ clients with sslnegotiation=direct)
server {
    listen 10.52.3.122:5432 ssl;

    include /etc/nginx/snippets/ssl-compute.dtu.dk.conf;
    ssl_alpn postgresql;

    proxy_pass postgres_local;
    proxy_connect_timeout 5s;
    proxy_timeout 1h;
    proxy_socket_keepalive on;
}
```

What it does:

- nginx listens on the server's network address, `10.52.3.122:5432`, and PostgreSQL only on
  `127.0.0.1:5432`, so the two share the port number without clashing, and nothing reaches
  PostgreSQL without passing through TLS.
- nginx ends TLS with the same DTU certificate as the website and forwards the plain
  connection to PostgreSQL. It only speaks direct TLS: `ssl_alpn postgresql` is what libpq 17+
  expects with `sslnegotiation=direct`, which is why `pis_lib/connect.py` sets that, and older
  clients that first ask for TLS inside the PostgreSQL protocol can't connect.
- PostgreSQL therefore sees every remote login as coming from `127.0.0.1`. That is the address
  the PAM line in `pg_hba.conf` trusts (`deploy/lib/postgres.sh`), and why the real client
  addresses are logged here instead, in `/var/log/nginx/postgres-stream.log`.
- A connection that sends nothing for an hour is closed (`proxy_timeout 1h`); the notebook
  then reconnects on its next query.

To check it from an analyst's machine (libpq 17+):

```sh
psql "host=psqdb.compute.dtu.dk dbname=pis_survey sslmode=verify-full sslnegotiation=direct sslrootcert=system" -c 'SELECT inet_client_addr()'
```

It should print `127.0.0.1`. Each connection then shows up in `postgres-stream.log`.

## Applying changes

Edit the file (`/etc/nginx/stream.d/postgres.conf` for the database port), or ask whoever
manages nginx, then check and reload:

```sh
sudo nano /etc/nginx/conf.d/psqdb.conf
sudo nginx -t && sudo systemctl reload nginx
curl -sI http://psqdb.compute.dtu.dk/ | head -n 3     # expect 301 and Location: https://...
```

nginx does not need to serve any files of this project. If traffic ever grows enough for
Django's file serving to matter, add WhiteNoise to Django rather than changing nginx.
