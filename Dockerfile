# Stage 1: Use a recent, stable Node.js version on a lightweight base (Alpine Linux)
# Using a specific version like '20' is better than 'latest' for predictable builds.
FROM node:20-alpine AS base

# Set the working directory inside the container
WORKDIR /usr/src/app


# Stage 2: Install dependencies
# This layer is cached by Docker. It only re-runs if package.json or package-lock.json changes.
FROM base AS deps
COPY package.json package-lock.json ./
# Use --only=production to skip installing devDependencies (like nodemon) in the final image
RUN npm install --only=production


# Stage 3: Build the final image
# Copy dependencies from the 'deps' stage and then the source code
FROM base AS final

# Set a non-root user for better security
# The 'node' user is created by the official Node.js base image
USER node

# Copy the installed node_modules from the 'deps' stage
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy the rest of the application source code
COPY . .

# Expose the port the app runs on. This is metadata for the user.
EXPOSE 3000

# The command to run the application
CMD ["node", "index.js"]