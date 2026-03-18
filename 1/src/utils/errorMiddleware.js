/**
 * 错误处理中间件
 * 提供统一的错误处理装饰器和中间件函数
 */

import { ErrorHandler, StorageError } from './errorHandler.js';

import {
  getUserFriendlyMessage,
  getErrorSeverity,
  getRetryStrategy,
  getErrorActions,
  getUserGuidance,
  shouldRetryError,
  ERROR_ACTIONS,
} from './errorConfig.js';

// 创建专用的错误处理器实例
const errorHandler = new ErrorHandler({
  enableNotifications: true,
  enableConsoleLog: true,
  enableRetry: true,
  maxRetries: 3,
  retryDelay: 1000,
});

/**
 * 方法装饰器 - 为类方法添加错误处理
 * @param {Object} options - 装饰器选项
 * @returns {Function} 装饰器函数
 */
export function withErrorHandling(options = {}) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      const operation =
        options.operation || `${target.constructor.name}.${propertyKey}`;
      const retryOptions = options.retry || {};

      try {
        return await errorHandler.wrapAsync(
          () => originalMethod.apply(this, args),
          operation,
          {
            enableRetry: shouldRetryError(options.errorCode),
            ...retryOptions,
          }
        );
      } catch (error) {
        // 应用错误处理策略
        await applyErrorHandlingStrategy(error, operation);
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * 函数包装器 - 为普通函数添加错误处理
 * @param {Function} fn - 要包装的函数
 * @param {string} operation - 操作名称
 * @param {Object} options - 选项
 * @returns {Function} 包装后的函数
 */
export function wrapWithErrorHandling(fn, operation, options = {}) {
  return async function (...args) {
    try {
      return await errorHandler.wrapAsync(
        () => fn.apply(this, args),
        operation,
        {
          enableRetry: shouldRetryError(options.errorCode),
          ...options,
        }
      );
    } catch (error) {
      await applyErrorHandlingStrategy(error, operation);
      throw error;
    }
  };
}

/**
 * API调用中间件
 * @param {Function} apiCall - API调用函数
 * @param {string} endpoint - API端点
 * @param {Object} options - 选项
 * @returns {Function} 包装后的API调用
 */
export function withApiErrorHandling(apiCall, endpoint, options = {}) {
  return wrapWithErrorHandling(apiCall, `API调用: ${endpoint}`, {
    errorCode: 'API_ERROR',
    retry: getRetryStrategy('API_ERROR'),
    ...options,
  });
}

/**
 * 存储操作中间件
 * @param {Function} storageOp - 存储操作函数
 * @param {string} operation - 操作类型
 * @param {Object} options - 选项
 * @returns {Function} 包装后的存储操作
 */
export function withStorageErrorHandling(storageOp, operation, options = {}) {
  return wrapWithErrorHandling(storageOp, `存储操作: ${operation}`, {
    errorCode: 'STORAGE_ERROR',
    retry: getRetryStrategy('STORAGE_ERROR'),
    ...options,
  });
}

/**
 * 网络请求中间件
 * @param {Function} networkCall - 网络请求函数
 * @param {string} url - 请求URL
 * @param {Object} options - 选项
 * @returns {Function} 包装后的网络请求
 */
export function withNetworkErrorHandling(networkCall, url, options = {}) {
  return wrapWithErrorHandling(networkCall, `网络请求: ${url}`, {
    errorCode: 'NETWORK_ERROR',
    retry: getRetryStrategy('NETWORK_ERROR'),
    ...options,
  });
}

/**
 * 任务执行中间件
 * @param {Function} task - 任务函数
 * @param {string} taskName - 任务名称
 * @param {Object} options - 选项
 * @returns {Function} 包装后的任务
 */
export function withTaskErrorHandling(task, taskName, options = {}) {
  return wrapWithErrorHandling(task, `任务执行: ${taskName}`, {
    errorCode: 'TASK_ERROR',
    retry: getRetryStrategy('DEFAULT'),
    ...options,
  });
}

/**
 * 应用错误处理策略
 * @param {Error} error - 错误对象
 * @param {string} operation - 操作名称
 * @param {Object} options - 选项
 */
async function applyErrorHandlingStrategy(error, operation) {
  const errorCode = error.code || 'UNKNOWN_ERROR';
  const actions = getErrorActions(errorCode);
  const severity = getErrorSeverity(errorCode);
  const guidance = getUserGuidance(errorCode);

  // 执行错误处理动作
  for (const action of actions) {
    switch (action) {
      case ERROR_ACTIONS.SHOW_NOTIFICATION:
        await showErrorNotification(error, operation, severity, guidance);
        break;

      case ERROR_ACTIONS.LOG_ERROR:
        logDetailedError(error, operation, severity);
        break;

      case ERROR_ACTIONS.CLEANUP_RESOURCES:
        await cleanupResources(error, operation);
        break;

      case ERROR_ACTIONS.REDIRECT_USER:
        await redirectUser(guidance);
        break;

      default:
        // 其他动作的处理
        break;
    }
  }
}

/**
 * 显示错误通知
 * @param {Error} error - 错误对象
 * @param {string} operation - 操作名称
 * @param {string} severity - 严重程度
 * @param {Object} guidance - 用户指导信息
 */
async function showErrorNotification(error, operation, severity, guidance) {
  try {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      const message = getUserFriendlyMessage(error.code, error.message);
      const title = guidance?.title || `操作失败 (${severity.toUpperCase()})`;

      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
        title: title,
        message: message,
        contextMessage: guidance?.message || operation,
      });
    }
  } catch (e) {
    console.warn('无法显示错误通知:', e);
  }
}

/**
 * 记录详细错误日志
 * @param {Error} error - 错误对象
 * @param {string} operation - 操作名称
 * @param {string} severity - 严重程度
 */
function logDetailedError(error, operation, severity) {
  const logLevel =
    severity === 'critical'
      ? 'error'
      : severity === 'high'
        ? 'error'
        : severity === 'medium'
          ? 'warn'
          : 'info';

  const logMessage = `[${severity.toUpperCase()}] ${operation}: ${error.message}`;
  const logData = {
    code: error.code,
    details: error.details,
    timestamp: error.timestamp,
    stack: error.stack,
  };

  console[logLevel](logMessage, logData);
}

/**
 * 清理资源
 * @param {Error} error - 错误对象
 * @param {string} operation - 操作名称
 */
async function cleanupResources(error, operation) {
  try {
    // 清理错误历史（保留最近的记录）
    errorHandler.cleanupErrorHistory();

    // 如果是存储错误，尝试清理部分数据
    if (error instanceof StorageError) {
      console.info(`[${operation}] 正在清理存储资源...`);
      // 这里可以添加具体的清理逻辑
    }
  } catch (e) {
    console.warn('资源清理失败:', e);
  }
}

/**
 * 重定向用户
 * @param {Object} guidance - 用户指导信息
 */
async function redirectUser(guidance) {
  if (guidance?.actionUrl) {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        await chrome.tabs.create({ url: guidance.actionUrl });
      }
    } catch (e) {
      console.warn('无法重定向用户:', e);
    }
  }
}

/**
 * 创建错误边界组件（用于React等框架）
 * @param {Function} fallbackComponent - 错误时显示的组件
 * @returns {Function} 错误边界组件
 */
export function createErrorBoundary(fallbackComponent) {
  return function ErrorBoundary(WrappedComponent) {
    return function (props) {
      try {
        return WrappedComponent(props);
      } catch (error) {
        errorHandler.handleError(error, 'UI渲染', true);
        return fallbackComponent ? fallbackComponent(error) : null;
      }
    };
  };
}

/**
 * 全局错误处理器
 * 捕获未处理的错误和Promise拒绝
 */
export function setupGlobalErrorHandling() {
  // 捕获未处理的错误
  if (typeof window !== 'undefined') {
    window.addEventListener('error', event => {
      const error = new Error(event.message);
      error.filename = event.filename;
      error.lineno = event.lineno;
      error.colno = event.colno;

      errorHandler.handleError(error, '全局错误', true);
    });

    // 捕获未处理的Promise拒绝
    window.addEventListener('unhandledrejection', event => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason));

      errorHandler.handleError(error, '未处理的Promise拒绝', true);
    });
  }
}

// 导出错误处理器实例
export { errorHandler };

// 导出便捷函数
export const logError = (error, operation) =>
  errorHandler.handleError(error, operation, false);
export const notifyError = (error, operation) =>
  errorHandler.handleError(error, operation, true);
export const getErrorStats = () => errorHandler.getErrorStats();
export const exportErrors = () => errorHandler.exportErrorHistory();
