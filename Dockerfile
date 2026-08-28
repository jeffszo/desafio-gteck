# Imagem única (build + runtime) usada pela verificação isolada. Só precisa ser
# reproduzível: builda a aplicação e, ao subir, aplica as migrations,
# roda o seed e inicia o servidor.
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && psql \"$DATABASE_URL\" -f prisma/seed.sql && node dist/main.js"]
