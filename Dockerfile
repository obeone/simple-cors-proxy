# Use an official lightweight Node.js image as a parent image
FROM node:22-slim

# HOME of the "nobody" user, needed at runtime by npm start
RUN mkdir /nonexistent && \
    chown -R nobody:nogroup /nonexistent

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files
COPY package*.json ./

# Install dependencies from the lockfile. This runs as root on purpose: the
# unprivileged user cannot write node_modules into the working directory.
RUN npm ci --omit=dev

# Bundle the source code inside the Docker image
COPY . .

# Drop privileges only once every step needing write access is done
USER nobody

# The application will listen on port 8080, so expose it
EXPOSE 8080

# Define the command to run the app
CMD [ "npm", "start" ]
