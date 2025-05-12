// Определяем возможные статусы задач
export type JobStatus =
  | 'active'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'paused'
  | 'wait' // BullMQ specific waiting state
  | 'prioritized'; // BullMQ specific state

// Определяем структуру для счетчиков задач по статусам
// Используем Partial, так как не все статусы могут присутствовать
export type JobCounts = Partial<Record<JobStatus, number>>;

// Определяем интерфейс для объекта задачи
export interface Job {
  id: string; // Идентификатор задачи (обычно строка в BullMQ)
  name: string; // Имя/тип задачи
  status: JobStatus; // Текущий статус
  timestamp?: number | string | Date | null; // Время создания
  processedOn?: number | string | Date | null; // Время начала обработки
  finishedOn?: number | string | Date | null; // Время завершения
  attemptsMade?: number; // Количество попыток
  data?: any; // Данные, связанные с задачей
  opts?: any; // Опции задачи (из BullMQ)
  failedReason?: string | null; // Причина сбоя
  returnValue?: any; // Возвращенное значение (если успешно)
  progress?: number | object | null; // Прогресс выполнения
  // Добавьте другие поля, если они используются
} 