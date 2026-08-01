# Use the official Microsoft Playwright image as the base
# This image contains all OS-level dependencies and browsers pre-installed.
FROM mcr.microsoft.com/playwright:v1.62.0-jammy

# Set the working directory inside the container
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies (only production dependencies to keep the image slim)
RUN npm ci --only=production

# Copy the rest of the application files
COPY . .

# Expose the port that Render uses
EXPOSE 10000

# Start the application
CMD ["node", "server.js"]
