# Imagen de la aplicación completa: la API Express también sirve la web compilada
# (server/index.js publica client/dist si existe), así que un solo proceso —y un solo
# origen— basta. Ningún secreto entra en la imagen: las variables se pasan al ejecutar.
FROM node:24-alpine AS web
WORKDIR /src
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-alpine AS deps
WORKDIR /src
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=deps /src/node_modules ./server/node_modules
COPY server ./server
COPY --from=web /src/dist ./client/dist
# El usuario node (uid 1000) existe en la imagen oficial: nada corre como root
USER node
EXPOSE 4000
# /api/estado no pide token: sirve igual como sondeo de salud del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/estado').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Sin --use-system-ca: ese flag es para máquinas con antivirus que inspecciona TLS
# (ver server/.env.example). En un contenedor de Linux no existe ese almacén de CA.
CMD ["node", "server/index.js"]
