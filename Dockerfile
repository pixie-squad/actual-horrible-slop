# Debian rather than Alpine: luau-lsp and darklua ship as glibc binaries.
FROM node:24-bookworm-slim

WORKDIR /app
COPY server.js index.html ./
COPY css ./css
COPY js ./js
COPY ext ./ext

# Language server, bundler and API definitions, pinned by hash (see ext/tools.js).
RUN node ext/tools.js

# Inside a container the server has to listen on all interfaces to be reachable.
# Projects, thumbnails, avatars and the audit log live in /data: mount a volume there.
ENV HOST=0.0.0.0 PORT=5173 NT_DATA=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 5173

USER node
CMD ["node", "server.js"]
