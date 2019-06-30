FROM node:11-alpine
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN npm install
COPY --chown=node:node src ./src
EXPOSE 8080
CMD [ "npm", "run", "api-dev" ]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget localhost:8080/v1/healthz -q -O - > /dev/null 2>&1
