# browser-mcp's image: the server and its dependencies, nothing else. The dependencies sit in /opt/node_modules,
# above the server's folder, so a checkout mounted over /opt/browser-mcp (compose does, to restart on every edit)
# runs on them; listening beyond loopback is compose's to ask (BROWSER_MCP_HOST), the Host check stays.
FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/Lowgular/linkedin-agent" \
      org.opencontainers.image.description="browser-mcp: browser tools as an MCP server over any browser's CDP"
WORKDIR /opt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --silent --no-audit --no-fund
COPY *.mjs start.sh /opt/browser-mcp/
WORKDIR /opt/browser-mcp
EXPOSE 9333
CMD ["node", "server.mjs"]
