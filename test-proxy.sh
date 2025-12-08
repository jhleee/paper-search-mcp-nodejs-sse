#!/bin/bash
# MCP 서버 리버스 프록시 테스트 스크립트

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 서버 URL (기본값)
SERVER_URL="${1:-https://paper-search-mcp.jhlee.me}"

echo "========================================="
echo "MCP Server Reverse Proxy Test"
echo "Server: $SERVER_URL"
echo "========================================="
echo ""

# 테스트 1: Health Check
echo "Test 1: Health Check"
echo "-------------------------------------"
HEALTH_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$SERVER_URL/health")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$HEALTH_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Health check passed${NC}"
    echo "Response: $BODY"
else
    echo -e "${RED}✗ Health check failed (HTTP $HTTP_CODE)${NC}"
    echo "Response: $BODY"
fi
echo ""

# 테스트 2: SSE Endpoint (GET)
echo "Test 2: SSE Endpoint (GET request)"
echo "-------------------------------------"
echo "Testing SSE connection (will timeout after 5 seconds)..."

SSE_RESPONSE=$(timeout 5 curl -N -s -w "\nHTTP_CODE:%{http_code}" \
  -H "Accept: text/event-stream, application/json" \
  "$SERVER_URL/mcp" 2>&1)

if echo "$SSE_RESPONSE" | grep -q "event:"; then
    echo -e "${GREEN}✓ SSE connection successful${NC}"
    echo "First few lines:"
    echo "$SSE_RESPONSE" | head -5
else
    echo -e "${RED}✗ SSE connection failed${NC}"
    echo "Response: $SSE_RESPONSE"
fi
echo ""

# 테스트 3: MCP Initialize (POST)
echo "Test 3: MCP Initialize Request"
echo "-------------------------------------"
INIT_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST "$SERVER_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }')

HTTP_CODE=$(echo "$INIT_RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$INIT_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q "result"; then
    echo -e "${GREEN}✓ Initialize request successful${NC}"
    echo "Response:"
    echo "$BODY" | head -10
else
    echo -e "${RED}✗ Initialize request failed (HTTP $HTTP_CODE)${NC}"
    echo "Response: $BODY"
fi
echo ""

# 테스트 4: Legacy SSE Endpoint
echo "Test 4: Legacy SSE Endpoint (/sse)"
echo "-------------------------------------"
echo "Testing legacy SSE endpoint (will timeout after 5 seconds)..."

LEGACY_RESPONSE=$(timeout 5 curl -N -s -w "\nHTTP_CODE:%{http_code}" \
  -H "Accept: text/event-stream, application/json" \
  "$SERVER_URL/sse" 2>&1)

if echo "$LEGACY_RESPONSE" | grep -q "event:"; then
    echo -e "${GREEN}✓ Legacy SSE endpoint works${NC}"
else
    echo -e "${YELLOW}⚠ Legacy SSE endpoint may not be working${NC}"
fi
echo ""

# 테스트 5: CORS Headers
echo "Test 5: CORS Headers"
echo "-------------------------------------"
CORS_HEADERS=$(curl -s -I -X OPTIONS "$SERVER_URL/mcp" \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST")

if echo "$CORS_HEADERS" | grep -qi "Access-Control-Allow-Origin"; then
    echo -e "${GREEN}✓ CORS headers present${NC}"
    echo "$CORS_HEADERS" | grep -i "Access-Control"
else
    echo -e "${RED}✗ CORS headers missing${NC}"
fi
echo ""

# 종합 결과
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Server URL: $SERVER_URL"
echo ""
echo "Common Issues and Solutions:"
echo ""
echo "1. If SSE tests fail with buffering issues:"
echo "   - Nginx: Add 'proxy_buffering off;'"
echo "   - Caddy: Add 'flush_interval -1'"
echo ""
echo "2. If connection drops immediately:"
echo "   - Increase proxy_read_timeout (Nginx)"
echo "   - Increase read_timeout (Caddy)"
echo ""
echo "3. If HTTP 502/504 errors:"
echo "   - Check if MCP server is running"
echo "   - Check proxy upstream configuration"
echo ""
echo "See docs/REVERSE_PROXY.md for detailed configuration"
echo "========================================="
