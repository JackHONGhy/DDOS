FROM node:20-alpine
WORKDIR /app
COPY master-server.js .
COPY worker-node.js .
COPY package.json .
RUN npm install
CMD ["node", "master-server.js"]
