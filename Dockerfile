FROM node:24-alpine

WORKDIR /app
COPY server.js index.html ./
COPY css ./css
COPY js ./js

# Inside a container the server has to listen on all interfaces to be reachable.
ENV HOST=0.0.0.0 PORT=5173
EXPOSE 5173

USER node
CMD ["node", "server.js"]
