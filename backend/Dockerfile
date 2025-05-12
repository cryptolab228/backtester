# Используем официальный образ Node.js LTS
FROM node:lts-alpine as builder

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Копируем исходный код
COPY . .

# Компилируем TypeScript
# Сначала установим devDependencies для компиляции
RUN npm install --only=development
RUN npm run build

# Удаляем devDependencies после сборки
RUN npm prune --production

# --- Второй этап: Создание чистого образа для продакшена ---
FROM node:lts-alpine

WORKDIR /app

# Копируем только необходимые артефакты из builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
# Копируем .env (предполагается, что он будет создан или смонтирован)
# COPY .env ./.env

# Открываем порт, который слушает приложение
EXPOSE 5000

# Запускаем приложение, предварительно регистрируя псевдонимы
CMD [ "node", "-r", "module-alias/register", "dist/app.js" ] 