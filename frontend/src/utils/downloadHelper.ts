/**
 * Утилита для скачивания больших файлов с поддержкой возобновления
 */

export interface DownloadProgress {
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
}

export type ProgressCallback = (progress: number, downloaded: number, total: number) => void;

export interface DownloadResult {
  success: boolean;
  size: number;
  filename: string;
}

export interface FileAccessTestResult {
  accessible: boolean;
  status?: number;
  statusText?: string;
  headers: {
    contentLength?: string | null;
    contentType?: string | null;
    contentDisposition?: string | null;
    acceptRanges?: string | null;
    cacheControl?: string | null;
    lastModified?: string | null;
  };
  error?: string;
}

export interface PortfolioDownloadUrls {
  static: string;
  api: string;
  directStatic: string;
  directApi: string;
}

export const downloadLargeFile = async (
  url: string, 
  filename: string, 
  onProgress: ProgressCallback | null = null
): Promise<DownloadResult> => {
  try {
    console.log(`🔽 Starting download: ${filename}`);
    
    // Проверяем доступность файла
    const headResponse = await fetch(url, { method: 'HEAD' });
    
    if (!headResponse.ok) {
      throw new Error(`File not accessible: ${headResponse.status} ${headResponse.statusText}`);
    }
    
    const contentLength = headResponse.headers.get('content-length');
    const acceptRanges = headResponse.headers.get('accept-ranges');
    const contentType = headResponse.headers.get('content-type');
    
    console.log(`📊 File info:`, {
      size: contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)}MB` : 'Unknown',
      supportsRanges: acceptRanges === 'bytes',
      contentType,
      url
    });
    
    // Основной запрос для скачивания
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, */*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    
    // Получаем поток данных
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }
    
    const chunks: Uint8Array[] = [];
    let receivedLength = 0;
    const totalLength = parseInt(contentLength || '0');
    
    console.log(`📥 Starting stream download...`);
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      
      // Отчет о прогрессе
      if (onProgress && totalLength > 0) {
        const progress = (receivedLength / totalLength) * 100;
        onProgress(progress, receivedLength, totalLength);
      }
      
      // Логируем прогресс каждые 10MB
      if (receivedLength % (10 * 1024 * 1024) < value.length) {
        console.log(`📈 Downloaded: ${(receivedLength / 1024 / 1024).toFixed(2)}MB / ${(totalLength / 1024 / 1024).toFixed(2)}MB`);
      }
    }
    
    console.log(`✅ Download completed: ${(receivedLength / 1024 / 1024).toFixed(2)}MB`);
    
    // Создаем Blob из всех chunks
    const blob = new Blob(chunks, { type: contentType || 'application/json' });
    
    // Создаем URL для скачивания
    const downloadUrl = window.URL.createObjectURL(blob);
    
    // Создаем ссылку для скачивания
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.style.display = 'none';
    
    // Добавляем ссылку в DOM и кликаем
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Освобождаем память
    window.URL.revokeObjectURL(downloadUrl);
    
    console.log(`💾 File saved as: ${filename}`);
    
    return {
      success: true,
      size: receivedLength,
      filename
    };
    
  } catch (error: any) {
    console.error(`❌ Download failed for ${filename}:`, error);
    throw error;
  }
};

/**
 * Тестирует доступность файла для скачивания
 */
export const testFileAccess = async (url: string): Promise<FileAccessTestResult> => {
  try {
    console.log(`🧪 Testing file access: ${url}`);
    
    const response = await fetch(url, { 
      method: 'HEAD'
    });
    
    const result: FileAccessTestResult = {
      accessible: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: {
        contentLength: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
        contentDisposition: response.headers.get('content-disposition'),
        acceptRanges: response.headers.get('accept-ranges'),
        cacheControl: response.headers.get('cache-control'),
        lastModified: response.headers.get('last-modified')
      }
    };
    
    console.log(`📋 Test result:`, result);
    return result;
    
  } catch (error: any) {
    console.error(`❌ Test failed:`, error);
    return {
      accessible: false,
      error: error.message,
      headers: {}
    };
  }
};

/**
 * Генерирует URL для скачивания файла портфельного бэктеста
 */
export const getPortfolioDownloadUrls = (filename: string): PortfolioDownloadUrls => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
  
  return {
    static: `${baseUrl}/portfolio-results/${filename}`,
    api: `${baseUrl}/api/data/portfolio-results/${filename}`,
    // Альтернативные URL для тестирования
    directStatic: `http://localhost:5000/portfolio-results/${filename}`,
    directApi: `http://localhost:5000/api/data/portfolio-results/${filename}`
  };
};

/**
 * Универсальная функция для скачивания файлов результатов
 */
export const downloadPortfolioResults = async (
  filename: string, 
  onProgress: ProgressCallback | null = null
): Promise<DownloadResult> => {
  const urls = getPortfolioDownloadUrls(filename);
  
  console.log(`🎯 Attempting to download: ${filename}`);
  console.log(`📍 Available URLs:`, urls);
  
  // Пробуем скачать с разных URL по порядку приоритета
  const urlsToTry = [
    { name: 'API Endpoint', url: urls.api },
    { name: 'Static Endpoint', url: urls.static },
    { name: 'Direct API', url: urls.directApi },
    { name: 'Direct Static', url: urls.directStatic }
  ];
  
  for (const { name, url } of urlsToTry) {
    try {
      console.log(`🔄 Trying ${name}: ${url}`);
      
      // Сначала тестируем доступность
      const testResult = await testFileAccess(url);
      
      if (testResult.accessible) {
        console.log(`✅ ${name} is accessible, proceeding with download...`);
        return await downloadLargeFile(url, filename, onProgress);
      } else {
        console.warn(`⚠️ ${name} not accessible:`, testResult);
      }
      
    } catch (error: any) {
      console.warn(`⚠️ ${name} failed:`, error.message);
    }
  }
  
  throw new Error(`All download URLs failed for file: ${filename}`);
}; 