FROM mcr.microsoft.com/playwright:v1.50.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc fluxbox novnc websockify && rm -rf /var/lib/apt/lists/*
ENV PORT=8080 DISPLAY=:99 SESSION_DIR=/data/sessions
EXPOSE 8080 6080
CMD ["/bin/bash", "-lc", "mkdir -p $SESSION_DIR; Xvfb :99 -screen 0 1440x980x24 & fluxbox & x11vnc -display :99 -forever -shared -nopw -rfbport 5900 & websockify --web /usr/share/novnc 6080 localhost:5900 & node src/index.js"]
