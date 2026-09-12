FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Phase 28: run as the "nginx" user the base image already creates
# (uid/gid 101) instead of root. nginx.conf listens on 8080 (see its own
# comment), not port 80, specifically so this works without the
# NET_BIND_SERVICE capability - binding a privileged port (<1024) is the
# one thing a non-root process genuinely cannot do, and nothing else this
# container does needs any elevated capability at all (see
# docker-compose.prod.yml's cap_drop). The paths below are exactly what
# nginx needs to write to at runtime (cache/proxy temp files, the pid
# file, and access/error logs, which the base image already symlinks to
# stdout/stderr) - chowned while still root, then switched away from.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid
USER nginx

# Phase 27: 443/8443 are documentation-only here (EXPOSE never actually
# publishes anything - docker-compose.prod.yml's `ports:` does that) -
# nginx.conf does not listen on either by default, only once you enable
# the HTTPS server block it documents. See nginx.conf's "Enabling HTTPS
# at this nginx" section.
EXPOSE 8080 8443
CMD ["nginx", "-g", "daemon off;"]
