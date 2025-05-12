# --- Этап 1: Сборка приложения Vue --- 
FROM node:lts-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

COPY . .

# Собираем статические файлы
RUN npm run build

# --- Этап 2: Сервировка статики через Nginx --- 
FROM nginx:stable-alpine

# Копируем собранные файлы из этапа builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Копируем конфигурацию Nginx (если нужна кастомная)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Открываем порт 80
EXPOSE 80

# Запускаем Nginx
CMD ["nginx", "-g", "daemon off;"] 