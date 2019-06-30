FROM node:11-alpine
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN npm install --production
COPY --chown=node:node build ./build
EXPOSE 8080
CMD [ "npm", "run", "wss-prod" ]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node ./build/healthcheck-wss.js ws://localhost:8080/healthz > /dev/null 2>&1
