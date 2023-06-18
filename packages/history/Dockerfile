
FROM node:18-alpine

WORKDIR /app
COPY . . 
RUN yarn install
RUN npx lerna run build --scope=history

# Cd to history
WORKDIR packages/history

# Expose the provided API_PORT
EXPOSE ${API_PORT}

CMD ["yarn", "run-production-reset"]

