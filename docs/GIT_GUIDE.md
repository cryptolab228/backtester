# Git & GitHub Terminal Guide

Пошаговый гайд по работе с Git через терминал.

---

## 1. Полный рабочий цикл (копируй и выполняй)

### Сценарий: Закончил работу → залил → merge в main → новая ветка

```bash
# 1. Проверить статус (какие файлы изменены)
git status

# 2. Добавить все изменения в индекс
git add .

# 3. Закоммитить с сообщением
git commit -m "feat: описание изменений"

# 4. Отправить текущую ветку на GitHub
git push

# 5. Переключиться на main
git checkout main

# 6. Получить последние изменения main с GitHub
git pull origin main

# 7. Слить свою ветку в main
git merge feature/my-branch

# 8. Отправить обновлённый main на GitHub
git push origin main

# 9. Создать новую ветку от main и переключиться на неё
git checkout -b feature/new-task

# 10. Продолжить работу в новой ветке...
```

---

## 2. Базовые команды

### Статус и информация
```bash
git status                    # Какие файлы изменены
git log --oneline -10         # Последние 10 коммитов
git branch                    # Список локальных веток
git branch -a                 # Все ветки (включая remote)
```

### Сохранение изменений
```bash
git add .                     # Добавить все файлы
git add file.ts               # Добавить конкретный файл
git commit -m "сообщение"     # Закоммитить
git commit -am "сообщение"    # add + commit (только для изменённых файлов)
```

### Отправка и получение
```bash
git push                      # Отправить на GitHub
git push -u origin branch     # Первая отправка новой ветки
git pull                      # Получить изменения
git fetch                     # Скачать без merge
```

---

## 3. Работа с ветками

### Создание и переключение
```bash
git branch feature/name       # Создать ветку
git checkout feature/name     # Переключиться на ветку
git checkout -b feature/name  # Создать и переключиться (одной командой)
git checkout main             # Вернуться на main
```

### Удаление веток
```bash
git branch -d feature/name    # Удалить локальную ветку (если слита)
git branch -D feature/name    # Принудительно удалить локальную
git push origin --delete feature/name  # Удалить на GitHub
```

### Слияние (merge)
```bash
git checkout main             # Переключиться на main
git pull origin main          # Обновить main
git merge feature/name        # Слить feature в main
git push origin main          # Отправить на GitHub
```

---

## 4. Откат изменений

### Отмена незакоммиченных изменений
```bash
git checkout -- file.ts       # Откатить один файл
git checkout -- .             # Откатить все файлы
git restore file.ts           # Альтернатива (новый синтаксис)
```

### Убрать из индекса (unstage)
```bash
git reset HEAD file.ts        # Убрать файл из staged
git reset HEAD                # Убрать все из staged
```

### Отмена коммитов
```bash
git reset --soft HEAD~1       # Отменить последний коммит (изменения останутся)
git reset --hard HEAD~1       # Отменить и удалить изменения (ОСТОРОЖНО!)
git revert HEAD               # Создать коммит-отмену (безопасно)
```

### Откат к конкретному коммиту
```bash
git log --oneline             # Найти хэш коммита
git reset --soft abc123       # Мягкий откат к коммиту abc123
git reset --hard abc123       # Жёсткий откат (ОСТОРОЖНО!)
```

---

## 5. Разрешение конфликтов

При merge может возникнуть конфликт:
```bash
git merge feature/name
# CONFLICT (content): Merge conflict in file.ts
```

**Решение:**
```bash
# 1. Открыть конфликтный файл, найти маркеры:
# <<<<<<< HEAD
# код из main
# =======
# код из feature
# >>>>>>> feature/name

# 2. Отредактировать файл, оставив нужный код

# 3. Добавить и закоммитить
git add .
git commit -m "fix: resolve merge conflict"
```

---

## 6. Stash (временное сохранение)

Когда нужно срочно переключиться, но есть незакоммиченные изменения:
```bash
git stash                     # Спрятать изменения
git checkout other-branch     # Переключиться
# ... сделать срочную работу ...
git checkout original-branch  # Вернуться
git stash pop                 # Восстановить изменения
```

---

## 7. Примеры рабочих сценариев

### Сценарий 1: Начать новую задачу
```bash
git checkout main
git pull origin main
git checkout -b feature/new-feature
# работаем...
```

### Сценарий 2: Закончить задачу и влить в main
```bash
git add .
git commit -m "feat: new feature complete"
git push -u origin feature/new-feature
git checkout main
git pull origin main
git merge feature/new-feature
git push origin main
git branch -d feature/new-feature
```

### Сценарий 3: Исправить баг в production
```bash
git checkout main
git pull origin main
git checkout -b fix/critical-bug
# исправляем...
git add .
git commit -m "fix: critical bug fixed"
git checkout main
git merge fix/critical-bug
git push origin main
```

### Сценарий 4: Откатить последний коммит (ещё не запушен)
```bash
git reset --soft HEAD~1       # Изменения вернутся в staged
# или
git reset --hard HEAD~1       # Изменения удалятся
```

### Сценарий 5: Откатить запушенный коммит (безопасно)
```bash
git revert HEAD               # Создаст новый коммит-отмену
git push
```

---

## 8. Формат сообщений коммитов

```
feat: новая функциональность
fix: исправление бага
refactor: рефакторинг кода
docs: изменения документации
style: форматирование
test: добавление тестов
chore: обновление зависимостей
```

**Примеры:**
```bash
git commit -m "feat: add scanner real-time mode"
git commit -m "fix: resolve PnL calculation bug"
git commit -m "refactor: optimize backtester performance"
git commit -m "docs: update README"
```

---

## 9. Полезные алиасы

Добавь в `.gitconfig` для удобства:
```bash
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.cm "commit -m"
git config --global alias.lg "log --oneline -15"
```

Теперь можно писать короче:
```bash
git st                        # вместо git status
git co main                   # вместо git checkout main
git br                        # вместо git branch
git cm "message"              # вместо git commit -m "message"
git lg                        # последние 15 коммитов
```

---

## 10. Рекомендации

- **Коммить часто** — маленькие коммиты легче откатить
- **Пиши понятные сообщения** — через месяц забудешь что делал
- **Не работай в main** — всегда создавай feature-ветку
- **Pull перед merge** — избежишь конфликтов
- **Удаляй слитые ветки** — не засоряй репозиторий
