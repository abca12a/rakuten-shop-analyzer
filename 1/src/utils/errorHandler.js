/**
 * 统一错误处理工具类
 * 提供一致的错误处理、日志记录和用户反馈机制
 */

// 基础错误类
export class BaseError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// 具体错误类型
export class ValidationError extends BaseError {
  constructor(message, field = null, value = null) {
    super(message, 'VALIDATION_ERROR', { field, value });
  }
}

export class NetworkError extends BaseError {
  constructor(message, url = null, status = null) {
    super(message, 'NETWORK_ERROR', { url, status });
  }
}

export class ApiError extends BaseError {
  constructor(message, endpoint = null, response = null) {
    super(message, 'API_ERROR', { endpoint, response });
  }
}

export class StorageError extends BaseError {
  constructor(message, operation = null, key = null) {
    super(message, 'STORAGE_ERROR', { operation, key });
  }
}

export class TaskError extends BaseError {
  constructor(message, taskType = null, taskData = null) {
    super(message, 'TASK_ERROR', { taskType, taskData });
  }
}

export class TimeoutError extends BaseError {
  constructor(message, timeout = null, operation = null) {
    super(message, 'TIMEOUT_ERROR', { timeout, operation });
  }
}

export class ConfigurationError extends BaseError {
  constructor(message, configKey = null, expectedValue = null) {
    super(message, 'CONFIGURATION_ERROR', { configKey, expectedValue });
  }
}

export class PermissionError extends BaseError {
  constructor(message, permission = null, resource = null) {
    super(message, 'PERMISSION_ERROR', { permission, resource });
  }
}

export class DataIntegrityError extends BaseError {
  constructor(message, dataType = null, expectedFormat = null) {
    super(message, 'DATA_INTEGRITY_ERROR', { dataType, expectedFormat });
  }
}

// 错误处理器类
export class ErrorHandler {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'error';
    this.enableNotifications = options.enableNotifications !== false;
    this.enableConsoleLog = options.enableConsoleLog !== false;
    this.enableRetry = options.enableRetry !== false;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.errorHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * 包装异步函数，提供统一的错误处理和重试机制
   * @param {Function} fn - 要执行的异步函数
   * @param {string} operation - 操作描述
   * @param {Object} options - 选项
   * @returns {Promise} 执行结果
   */
  async wrapAsync(fn, operation, options = {}) {
    const {
      throwOnError = true,
      defaultValue = null,
      errorCode = 'OPERATION_ERROR',
      context = {},
      enableRetry = this.enableRetry,
      maxRetries = this.maxRetries,
      retryDelay = this.retryDelay,
      retryCondition = null,
    } = options;

    let lastError = null;
    let attempts = 0;
    const maxAttempts = enableRetry ? maxRetries + 1 : 1;

    while (attempts < maxAttempts) {
      try {
        const result = await fn();

        // 如果之前有失败但最终成功，记录恢复信息
        if (attempts > 0) {
          this._logRecovery(operation, attempts, lastError);
        }

        return result;
      } catch (error) {
        lastError = error;
        attempts++;

        const wrappedError = this._wrapError(
          error,
          operation,
          errorCode,
          context
        );
        this._addToHistory(wrappedError, operation);

        // 检查是否应该重试
        const shouldRetry =
          attempts < maxAttempts && this._shouldRetry(error, retryCondition);

        if (shouldRetry) {
          this._logRetry(operation, attempts, maxAttempts, error);
          await this._delay(retryDelay * attempts); // 指数退避
          continue;
        }

        // 最终失败，记录错误
        this._logError(wrappedError, operation);

        if (throwOnError) {
          throw wrappedError;
        }

        return defaultValue;
      }
    }
  }

  /**
   * 带重试的异步操作执行器
   * @param {Function} fn - 要执行的异步函数
   * @param {string} operation - 操作描述
   * @param {Object} retryOptions - 重试选项
   * @returns {Promise} 执行结果
   */
  async executeWithRetry(fn, operation, retryOptions = {}) {
    return this.wrapAsync(fn, operation, {
      enableRetry: true,
      ...retryOptions,
    });
  }

  /**
   * 处理和格式化错误
   * @param {Error} error - 原始错误
   * @param {string} operation - 操作描述
   * @param {boolean} notify - 是否显示通知
   * @returns {Object} 格式化的错误信息
   */
  handleError(error, operation, notify = false) {
    const formattedError = this._formatError(error, operation);

    this._logError(error, operation);

    if (notify && this.enableNotifications) {
      this._showErrorNotification(formattedError);
    }

    return formattedError;
  }

  /**
   * 验证输入参数
   * @param {Object} params - 参数对象
   * @param {Object} rules - 验证规则
   * @throws {ValidationError} 验证失败时抛出
   */
  validateParams(params, rules) {
    for (const [field, rule] of Object.entries(rules)) {
      const value = params[field];

      if (
        rule.required &&
        (value === null || value === undefined || value === '')
      ) {
        throw new ValidationError(`参数 ${field} 是必需的`, field, value);
      }

      if (value !== null && value !== undefined) {
        if (rule.type && typeof value !== rule.type) {
          throw new ValidationError(
            `参数 ${field} 类型错误，期望 ${rule.type}，实际 ${typeof value}`,
            field,
            value
          );
        }

        if (rule.minLength && value.length < rule.minLength) {
          throw new ValidationError(
            `参数 ${field} 长度不能少于 ${rule.minLength}`,
            field,
            value
          );
        }

        if (rule.maxLength && value.length > rule.maxLength) {
          throw new ValidationError(
            `参数 ${field} 长度不能超过 ${rule.maxLength}`,
            field,
            value
          );
        }

        if (rule.pattern && !rule.pattern.test(value)) {
          throw new ValidationError(`参数 ${field} 格式不正确`, field, value);
        }
      }
    }
  }

  /**
   * 创建标准化的错误响应
   * @param {Error} error - 错误对象
   * @param {string} operation - 操作描述
   * @param {Object} additionalData - 额外数据
   * @returns {Object} 标准化错误响应
   */
  createErrorResponse(error, operation, additionalData = {}) {
    return {
      success: false,
      error: error.message || '未知错误',
      code: error.code || 'UNKNOWN_ERROR',
      operation: operation,
      timestamp: new Date().toISOString(),
      ...additionalData,
    };
  }

  /**
   * 创建标准化的成功响应
   * @param {*} data - 响应数据
   * @param {string} operation - 操作描述
   * @param {Object} additionalData - 额外数据
   * @returns {Object} 标准化成功响应
   */
  createSuccessResponse(data, operation, additionalData = {}) {
    return {
      success: true,
      data: data,
      operation: operation,
      timestamp: new Date().toISOString(),
      ...additionalData,
    };
  }

  /**
   * 获取错误统计信息
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Object} 错误统计
   */
  getErrorStats(timeRange = 24 * 60 * 60 * 1000) {
    // 默认24小时
    const now = Date.now();
    const cutoff = now - timeRange;

    const recentErrors = this.errorHistory.filter(
      entry => new Date(entry.timestamp).getTime() > cutoff
    );

    const errorsByCode = {};
    const errorsByOperation = {};

    recentErrors.forEach(entry => {
      // 按错误代码统计
      errorsByCode[entry.code] = (errorsByCode[entry.code] || 0) + 1;

      // 按操作统计
      errorsByOperation[entry.operation] =
        (errorsByOperation[entry.operation] || 0) + 1;
    });

    return {
      totalErrors: recentErrors.length,
      timeRange: timeRange,
      errorsByCode: errorsByCode,
      errorsByOperation: errorsByOperation,
      mostCommonError: this._getMostCommon(errorsByCode),
      mostProblematicOperation: this._getMostCommon(errorsByOperation),
      recentErrors: recentErrors.slice(-10), // 最近10个错误
    };
  }

  /**
   * 清理错误历史
   * @param {number} maxAge - 最大保留时间（毫秒）
   */
  cleanupErrorHistory(maxAge = 7 * 24 * 60 * 60 * 1000) {
    // 默认7天
    const cutoff = Date.now() - maxAge;
    this.errorHistory = this.errorHistory.filter(
      entry => new Date(entry.timestamp).getTime() > cutoff
    );
  }

  /**
   * 导出错误历史
   * @returns {string} JSON格式的错误历史
   */
  exportErrorHistory() {
    return JSON.stringify(
      {
        exportTime: new Date().toISOString(),
        errorHistory: this.errorHistory,
        stats: this.getErrorStats(),
      },
      null,
      2
    );
  }

  // 私有方法
  _wrapError(error, operation, errorCode, context) {
    if (error instanceof BaseError) {
      return error;
    }

    return new TaskError(`${operation}失败: ${error.message}`, operation, {
      originalError: error,
      context,
    });
  }

  _formatError(error, operation) {
    return {
      message: error.message || '未知错误',
      code: error.code || 'UNKNOWN_ERROR',
      operation: operation,
      timestamp: error.timestamp || new Date().toISOString(),
      details: error.details || null,
    };
  }

  _logError(error, operation) {
    if (!this.enableConsoleLog) return;

    const logMessage = `[${operation}] ${error.message}`;

    if (error instanceof BaseError) {
      console.error(logMessage, {
        code: error.code,
        details: error.details,
        timestamp: error.timestamp,
      });
    } else {
      console.error(logMessage, error);
    }
  }

  _showErrorNotification(errorInfo) {
    try {
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'images/icon48.png',
          title: '操作失败',
          message: errorInfo.message,
        });
      }
    } catch (e) {
      console.warn('无法显示错误通知:', e);
    }
  }

  _shouldRetry(error, retryCondition) {
    // 如果提供了自定义重试条件
    if (typeof retryCondition === 'function') {
      return retryCondition(error);
    }

    // 默认重试条件
    if (error instanceof NetworkError) {
      return true; // 网络错误通常可以重试
    }

    if (error instanceof TimeoutError) {
      return true; // 超时错误可以重试
    }

    if (error instanceof ApiError) {
      // API错误根据状态码决定是否重试
      const status = error.details?.status;
      return status >= 500 || status === 429; // 服务器错误或限流
    }

    // 其他错误类型默认不重试
    return false;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _addToHistory(error, operation) {
    const entry = {
      timestamp: error.timestamp || new Date().toISOString(),
      operation: operation,
      message: error.message,
      code: error.code,
      details: error.details,
    };

    this.errorHistory.push(entry);

    // 保持历史记录大小限制
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  _logRetry(operation, attempt, maxAttempts, error) {
    if (this.enableConsoleLog) {
      console.warn(
        `[${operation}] 第${attempt}次尝试失败，将重试 (${attempt}/${maxAttempts}): ${error.message}`
      );
    }
  }

  _logRecovery(operation, attempts, lastError) {
    if (this.enableConsoleLog) {
      console.info(
        `[${operation}] 经过${attempts}次重试后成功恢复，上次错误: ${lastError.message}`
      );
    }
  }

  _getMostCommon(obj) {
    let maxCount = 0;
    let mostCommon = null;

    for (const [key, count] of Object.entries(obj)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = key;
      }
    }

    return mostCommon ? { key: mostCommon, count: maxCount } : null;
  }
}

// 创建默认错误处理器实例
export const defaultErrorHandler = new ErrorHandler();

// 便捷函数
export const wrapAsync = (fn, operation, options) =>
  defaultErrorHandler.wrapAsync(fn, operation, options);

export const executeWithRetry = (fn, operation, retryOptions) =>
  defaultErrorHandler.executeWithRetry(fn, operation, retryOptions);

export const handleError = (error, operation, notify) =>
  defaultErrorHandler.handleError(error, operation, notify);

export const validateParams = (params, rules) =>
  defaultErrorHandler.validateParams(params, rules);

export const createErrorResponse = (error, operation, additionalData) =>
  defaultErrorHandler.createErrorResponse(error, operation, additionalData);

export const createSuccessResponse = (data, operation, additionalData) =>
  defaultErrorHandler.createSuccessResponse(data, operation, additionalData);

export const getErrorStats = timeRange =>
  defaultErrorHandler.getErrorStats(timeRange);

export const cleanupErrorHistory = maxAge =>
  defaultErrorHandler.cleanupErrorHistory(maxAge);

export const exportErrorHistory = () =>
  defaultErrorHandler.exportErrorHistory();

// 错误类型检查函数
export const isNetworkError = error => error instanceof NetworkError;
export const isApiError = error => error instanceof ApiError;
export const isValidationError = error => error instanceof ValidationError;
export const isTimeoutError = error => error instanceof TimeoutError;
export const isConfigurationError = error =>
  error instanceof ConfigurationError;
export const isPermissionError = error => error instanceof PermissionError;
export const isDataIntegrityError = error =>
  error instanceof DataIntegrityError;
