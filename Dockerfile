# Stage 1: Use an official Node.js runtime as a parent image.
# Using alpine version for a smaller image size. node:20 is a recent LTS version.
FROM node:20-alpine AS base

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock, etc.)
COPY package*.json ./

# Stage 2: Install dependencies
# Use 'npm ci' for production builds as it's faster and uses package-lock.json
# for deterministic builds. We only install production dependencies.
FROM base AS deps
RUN npm ci --only=production

# Stage 3: Build the final image
# Copy dependencies from the 'deps' stage
FROM base AS final
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy the rest of the application source code
COPY . .

# Create a non-root user for security best practices
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose the port the app runs on. Your app uses 3000 as a default.
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "index.js" ]