# Debian rather than Alpine: luau-lsp and darklua ship as glibc binaries.
FROM node:24-bookworm-slim

WORKDIR /app
COPY server.js index.html ./
COPY js ./js
COPY styles ./styles
COPY ext ./ext

# Language server, bundler and API definitions, pinned by hash (see ext/tools.js).
RUN node ext/tools.js

# Inside a container the server has to listen on all interfaces to be reachable.
# It keeps nothing, so there is no volume to mount.
ENV HOST=0.0.0.0 PORT=5173
EXPOSE 5173

USER node
CMD ["node", "server.js"]
