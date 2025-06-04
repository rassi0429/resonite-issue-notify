# Use official Node.js LTS image
FROM node:22-slim

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Expose port (if needed, e.g. 3000)
# EXPOSE 3000

# Command to run the app
CMD ["node", "main.mjs"]
