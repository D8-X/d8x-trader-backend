FROM node:20-alpine
WORKDIR /app

# Copy necessary files for dependency installation
COPY package.json yarn.lock .
COPY ./nx.json .
COPY ./lerna.json .
COPY ./config/. ./config/.
COPY ./packages/utils ./packages/utils
COPY ./packages/history ./packages/history
RUN apk add --no-cache openssl openssl3 ca-certificates
# Generate .npmrc and install in one step, then clean up
RUN --mount=type=secret,id=npm_token \
    echo "@d8-x:registry=https://npm.pkg.github.com" > .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    yarn install && \
    rm -f .npmrc

# Build the history project
RUN npx lerna run build --scope=history

# Change to history directory
WORKDIR packages/history

# Expose the provided API_PORT
EXPOSE ${MAIN_API_PORT_HTTP}

# CMD ["yarn", "run-production-reset"]
CMD ["yarn", "run-production"]