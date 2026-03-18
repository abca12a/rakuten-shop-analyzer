/**
 * API连接稳定性增强模块
 * 提供智能重试、连接池管理、网络状态监控等功能
 */

import { NetworkError } from '../utils/errorHandler.js';

function parseErrorBody(errorText) {
  if (!errorText) return null;

  try {
    return JSON.parse(errorText);
  } catch {
    return null;
  }
}

function buildHttpErrorMessage(response, errorText) {
  const baseMessage =
    `HTTP ${response?.status || 'Unknown'}: ` +
    `${response?.statusText || 'Network Error'}`;
  const parsedError = parseErrorBody(errorText);

  const apiMessage =
    parsedError?.error_description ||
    parsedError?.errors?.errorMessage ||
    parsedError?.message ||
    parsedError?.error ||
    '';

  if (!apiMessage) {
    return baseMessage;
  }

  if (apiMessage === 'CLIENT_IP_NOT_ALLOWED') {
    return (
      `${baseMessage} (${apiMessage})` +
      '。当前版本已经改为通过固定服务器代理访问 Rakuten。请检查 Rakuten 应用的 Allowed IP addresses 是否已经放行你的服务器公网 IP。'
    );
  }

  return `${baseMessage} (${apiMessage})`;
}

/**
 * 连接稳定性管理器
 */
export class ConnectionStabilizer {
  constructor(options = {}) {
    this.options = {
      // 基础重试配置
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      jitterFactor: 0.1,

      // 连接池配置
      maxConcurrentRequests: 10,
      requestTimeout: 30000,
      keepAliveTimeout: 60000,

      // 网络状态监控
      healthCheckInterval: 30000,
      healthCheckUrl: 'https://api.845817074.xyz/health',

      // 智能重试配置
      enableAdaptiveRetry: true,
      enableCircuitBreaker: true,
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,

      ...options,
    };

    // 连接状态
    this.activeRequests = new Set();
    this.requestQueue = [];
    this.isHealthy = true;
    this.lastHealthCheck = null;
    this.consecutiveFailures = 0;
    this.circuitBreakerOpen = false;
    this.circuitBreakerOpenTime = null;

    // 性能统计
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      retryCount: 0,
      circuitBreakerTrips: 0,
    };

    // 启动健康检查（仅在浏览器环境中）
    if (
      typeof window !== 'undefined' &&
      this.options.healthCheckInterval < 999999
    ) {
      this._startHealthCheck();
    }
  }

  /**
   * 增强的fetch包装器，提供智能重试和连接管理
   * @param {string} url - 请求URL
   * @param {Object} options - fetch选项
   * @param {Object} retryOptions - 重试选项
   * @returns {Promise<Response>} 响应对象
   */
  async enhancedFetch(url, options = {}, retryOptions = {}) {
    const requestId = this._generateRequestId();
    const startTime = Date.now();

    try {
      // 检查熔断器状态
      if (this._isCircuitBreakerOpen()) {
        throw new NetworkError('服务暂时不可用，请稍后重试', url, 503);
      }

      // 等待连接池可用
      await this._waitForConnectionSlot(requestId);

      // 执行请求
      const response = await this._executeRequestWithRetry(
        url,
        options,
        retryOptions,
        requestId,
        startTime
      );

      // 更新成功统计
      this._updateSuccessStats(startTime);
      this.consecutiveFailures = 0;

      return response;
    } catch (error) {
      // 更新连续失败次数（统计信息已在重试循环中更新）
      this.consecutiveFailures++;
      throw error;
    } finally {
      // 清理连接
      this._releaseConnection(requestId);
    }
  }

  /**
   * 执行带重试的请求
   */
  async _executeRequestWithRetry(
    url,
    options,
    retryOptions,
    requestId,
    startTime
  ) {
    const mergedOptions = {
      ...this.options,
      ...retryOptions,
    };

    let lastError = null;
    let attempt = 0;

    while (attempt <= mergedOptions.maxRetries) {
      try {
        // 添加超时控制
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => {
          timeoutController.abort();
        }, mergedOptions.requestTimeout);

        const requestOptions = {
          ...options,
          signal: timeoutController.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json',
            'Cache-Control': 'no-cache',
            ...options.headers,
          },
        };

        console.log(
          `[${requestId}] 尝试请求 (${attempt + 1}/${mergedOptions.maxRetries + 1}): ${url}`
        );

        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId);

        // 检查响应状态
        if (!response || !response.ok) {
          const errorText = response ? await response.text() : '';
          const networkError = new NetworkError(
            buildHttpErrorMessage(response, errorText),
            url,
            response?.status || 0
          );

          if (errorText) {
            networkError.details = {
              ...networkError.details,
              responseBody: errorText,
            };
          }

          throw networkError;
        }

        console.log(
          `[${requestId}] 请求成功，耗时: ${Date.now() - startTime}ms`
        );
        return response;
      } catch (error) {
        lastError = error;
        attempt++;

        // 更新失败统计（每次尝试都计算）
        this.stats.totalRequests++;
        this.stats.failedRequests++;

        // 判断是否应该重试
        if (attempt > mergedOptions.maxRetries || !this._shouldRetry(error)) {
          break;
        }

        // 计算重试延迟
        const delay = this._calculateRetryDelay(attempt, mergedOptions);
        console.log(
          `[${requestId}] 请求失败，${delay}ms后重试: ${error.message}`
        );

        // 等待重试
        await this._delay(delay);
        this.stats.retryCount++;
      }
    }

    throw lastError;
  }

  /**
   * 判断是否应该重试
   */
  _shouldRetry(error) {
    // 网络错误通常可以重试
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }

    // AbortError（超时）可以重试
    if (error.name === 'AbortError') {
      return true;
    }

    // 普通的Error对象（通常是网络错误）可以重试
    if (
      error instanceof Error &&
      (error.message.includes('Network error') ||
        error.message.includes('network') ||
        error.message.includes('fetch'))
    ) {
      return true;
    }

    // 特定HTTP状态码可以重试
    if (error instanceof NetworkError) {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      return retryableStatuses.includes(error.details.status);
    }

    return false;
  }

  /**
   * 计算重试延迟（指数退避 + 抖动）
   */
  _calculateRetryDelay(attempt, options) {
    const exponentialDelay = Math.min(
      options.baseDelay * Math.pow(options.backoffFactor, attempt - 1),
      options.maxDelay
    );

    // 添加抖动以避免雷群效应
    const jitter = exponentialDelay * options.jitterFactor * Math.random();

    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * 等待连接池可用
   */
  async _waitForConnectionSlot(requestId) {
    if (this.activeRequests.size < this.options.maxConcurrentRequests) {
      this.activeRequests.add(requestId);
      return;
    }

    // 加入等待队列
    return new Promise(resolve => {
      this.requestQueue.push({ requestId, resolve });
    });
  }

  /**
   * 释放连接
   */
  _releaseConnection(requestId) {
    this.activeRequests.delete(requestId);

    // 处理等待队列
    if (this.requestQueue.length > 0) {
      const { requestId: waitingId, resolve } = this.requestQueue.shift();
      this.activeRequests.add(waitingId);
      resolve();
    }
  }

  /**
   * 检查熔断器状态
   */
  _isCircuitBreakerOpen() {
    if (!this.options.enableCircuitBreaker) {
      return false;
    }

    if (this.circuitBreakerOpen) {
      // 检查是否可以尝试恢复
      const timeSinceOpen = Date.now() - this.circuitBreakerOpenTime;
      if (timeSinceOpen > this.options.circuitBreakerTimeout) {
        console.log('熔断器尝试半开状态');
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenTime = null;
        return false;
      }
      return true;
    }

    // 检查是否需要打开熔断器
    if (this.consecutiveFailures >= this.options.circuitBreakerThreshold) {
      console.log(`连续失败${this.consecutiveFailures}次，打开熔断器`);
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenTime = Date.now();
      this.stats.circuitBreakerTrips++;
      return true;
    }

    return false;
  }

  /**
   * 启动健康检查
   */
  _startHealthCheck() {
    if (typeof window === 'undefined') return; // 非浏览器环境跳过

    setInterval(async () => {
      try {
        const startTime = Date.now();
        const response = await fetch(this.options.healthCheckUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        const responseTime = Date.now() - startTime;
        this.isHealthy = response.ok;
        this.lastHealthCheck = new Date();

        console.log(
          `健康检查: ${this.isHealthy ? '正常' : '异常'}, 响应时间: ${responseTime}ms`
        );
      } catch (error) {
        this.isHealthy = false;
        this.lastHealthCheck = new Date();
        console.log('健康检查失败:', error.message);
      }
    }, this.options.healthCheckInterval);
  }

  /**
   * 更新成功统计
   */
  _updateSuccessStats(startTime) {
    this.stats.totalRequests++;
    this.stats.successfulRequests++;

    const responseTime = Date.now() - startTime;
    this.stats.averageResponseTime =
      (this.stats.averageResponseTime * (this.stats.successfulRequests - 1) +
        responseTime) /
      this.stats.successfulRequests;
  }

  /**
   * 更新失败统计
   */
  _updateFailureStats() {
    this.stats.totalRequests++;
    this.stats.failedRequests++;
    this.consecutiveFailures++;
  }

  /**
   * 生成请求ID
   */
  _generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 延迟函数
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus() {
    return {
      isHealthy: this.isHealthy,
      lastHealthCheck: this.lastHealthCheck,
      activeRequests: this.activeRequests.size,
      queuedRequests: this.requestQueue.length,
      circuitBreakerOpen: this.circuitBreakerOpen,
      consecutiveFailures: this.consecutiveFailures,
      stats: { ...this.stats },
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      retryCount: 0,
      circuitBreakerTrips: 0,
    };
    this.consecutiveFailures = 0;
  }
}

// 创建默认实例
export const defaultConnectionStabilizer = new ConnectionStabilizer();

// 便捷函数
export const enhancedFetch = (url, options, retryOptions) =>
  defaultConnectionStabilizer.enhancedFetch(url, options, retryOptions);

export const getConnectionStatus = () =>
  defaultConnectionStabilizer.getConnectionStatus();
