# Reverse Proxy Configuration for MCP Server

MCP 서버는 StreamableHTTP 프로토콜을 사용하며, SSE(Server-Sent Events)를 지원합니다. 리버스 프록시를 통해 사용할 때는 다음 설정이 필요합니다.

## 주요 요구사항

1. **버퍼링 비활성화**: SSE는 실시간 스트리밍이 필요하므로 프록시 버퍼링을 꺼야 합니다
2. **긴 타임아웃**: MCP 연결은 오래 유지될 수 있으므로 타임아웃을 충분히 길게 설정
3. **청크 인코딩 지원**: Transfer-Encoding: chunked를 올바르게 처리해야 함
4. **HTTP/1.1 지원**: SSE는 HTTP/1.1이 필요합니다

## Nginx 설정 예시

```nginx
server {
    listen 443 ssl http2;
    server_name paper-search-mcp.jhlee.me;

    # SSL 설정
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;

        # 필수: 버퍼링 비활성화
        proxy_buffering off;
        proxy_cache off;

        # 필수: SSE를 위한 헤더 설정
        proxy_set_header Connection '';
        proxy_http_version 1.1;

        # 필수: 긴 타임아웃 (SSE는 오래 열려있을 수 있음)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # 권장: 일반 프록시 헤더
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 권장: 청크 인코딩 설정
        chunked_transfer_encoding on;
    }
}
```

## Caddy 설정 예시

```caddy
paper-search-mcp.jhlee.me {
    reverse_proxy localhost:3000 {
        # SSE를 위한 플러시 간격 설정 (즉시 전송)
        flush_interval -1

        # 긴 타임아웃
        transport http {
            read_timeout 24h
            write_timeout 24h
        }
    }
}
```

## Apache 설정 예시

```apache
<VirtualHost *:443>
    ServerName paper-search-mcp.jhlee.me

    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem

    ProxyRequests Off
    ProxyPreserveHost On

    # 버퍼링 비활성화
    SetEnv proxy-nokeepalive 1
    SetEnv proxy-sendchunked 1

    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    # 긴 타임아웃
    ProxyTimeout 86400
</VirtualHost>
```

## Traefik 설정 예시

```yaml
http:
  routers:
    mcp-server:
      rule: "Host(`paper-search-mcp.jhlee.me`)"
      service: mcp-service
      tls:
        certResolver: letsencrypt

  services:
    mcp-service:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
        # SSE 지원을 위한 설정
        responseForwarding:
          flushInterval: "1ms"
```

## 문제 해결

### 1. "Server not found" 오류

**원인**: 프록시가 SSE 이벤트를 버퍼링하여 클라이언트에 전달하지 않음

**해결책**:
- Nginx: `proxy_buffering off;` 추가
- Caddy: `flush_interval -1` 추가
- Apache: `SetEnv proxy-sendchunked 1` 추가

### 2. 연결이 바로 끊김

**원인**: 타임아웃 설정이 너무 짧음

**해결책**:
- Nginx: `proxy_read_timeout 86400s;` (24시간) 추가
- Caddy: `read_timeout 24h` 추가
- Apache: `ProxyTimeout 86400` 추가

### 3. CORS 오류

**원인**: 프록시가 CORS 헤더를 차단하거나 중복 추가

**해결책**:
MCP 서버가 이미 CORS 헤더를 설정하므로 프록시에서는 추가 설정 불필요.
만약 문제가 있다면:

```nginx
# Nginx - CORS 헤더 추가 (MCP 서버 설정이 작동하지 않는 경우에만)
add_header Access-Control-Allow-Origin * always;
add_header Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS" always;
add_header Access-Control-Allow-Headers "Content-Type, X-Session-Id" always;
```

### 4. SSE 이벤트가 도착하지 않음

**원인**: HTTP/2 사용 시 SSE 호환성 문제

**해결책**:
```nginx
# upstream 연결은 HTTP/1.1 사용
proxy_http_version 1.1;
proxy_set_header Connection '';
```

## 테스트 방법

### 1. Health Check 테스트
```bash
curl https://paper-search-mcp.jhlee.me/health
```

예상 결과:
```json
{"status":"healthy","name":"paper-search-mcp-nodejs","version":"0.3.0","transport":"StreamableHTTP"}
```

### 2. SSE 연결 테스트
```bash
curl -N -H "Accept: text/event-stream, application/json" \
     https://paper-search-mcp.jhlee.me/mcp
```

예상 결과: SSE 이벤트 스트림이 즉시 시작되어야 함

### 3. MCP Initialize 테스트
```bash
curl -X POST https://paper-search-mcp.jhlee.me/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

## 추천 설정

가장 간단하고 안정적인 설정은 **Caddy**를 사용하는 것입니다:

```caddy
paper-search-mcp.jhlee.me {
    reverse_proxy localhost:3000 {
        flush_interval -1
    }
}
```

Caddy는 자동으로:
- Let's Encrypt SSL 인증서 발급
- HTTP/2 지원
- SSE에 최적화된 기본 설정
- 자동 재시작

## Docker Compose 예시 (Caddy 포함)

```yaml
version: '3.8'

services:
  mcp-server:
    build: .
    container_name: paper-search-mcp
    environment:
      - PORT=3000
      - HOST=0.0.0.0
    networks:
      - mcp-network
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    container_name: mcp-caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - mcp-network
    restart: unless-stopped

networks:
  mcp-network:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
```
