/**
 * 性能优化工具模块
 * 提供内存管理、数据处理优化和性能监控功能
 */

/**
 * 内存管理器
 * 负责监控和优化内存使用
 */
export class MemoryManager {
  constructor() {
    this.memoryThreshold = 50 * 1024 * 1024; // 50MB阈值
    this.cleanupCallbacks = new Set();
    this.monitoringInterval = null;
  }

  /**
   * 开始内存监控
   * @param {number} interval - 监控间隔（毫秒）
   */
  startMonitoring(interval = 30000) {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, interval);

    console.log('[MemoryManager] 内存监控已启动');
  }

  /**
   * 停止内存监控
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[MemoryManager] 内存监控已停止');
    }
  }

  /**
   * 检查内存使用情况
   */
  async checkMemoryUsage() {
    try {
      if (performance.memory) {
        const memInfo = performance.memory;
        const usedMemory = memInfo.usedJSHeapSize;
        const totalMemory = memInfo.totalJSHeapSize;
        const memoryLimit = memInfo.jsHeapSizeLimit;

        console.log(
          `[MemoryManager] 内存使用: ${(usedMemory / 1024 / 1024).toFixed(2)}MB / ${(totalMemory / 1024 / 1024).toFixed(2)}MB (限制: ${(memoryLimit / 1024 / 1024).toFixed(2)}MB)`
        );

        // 如果内存使用超过阈值，触发清理
        if (usedMemory > this.memoryThreshold) {
          console.warn('[MemoryManager] 内存使用超过阈值，开始清理');
          await this.triggerCleanup();
        }
      }
    } catch (error) {
      console.error('[MemoryManager] 检查内存使用时出错:', error);
    }
  }

  /**
   * 注册清理回调
   * @param {Function} callback - 清理回调函数
   */
  registerCleanupCallback(callback) {
    this.cleanupCallbacks.add(callback);
  }

  /**
   * 注销清理回调
   * @param {Function} callback - 清理回调函数
   */
  unregisterCleanupCallback(callback) {
    this.cleanupCallbacks.delete(callback);
  }

  /**
   * 触发内存清理
   */
  async triggerCleanup() {
    console.log('[MemoryManager] 开始执行内存清理');

    for (const callback of this.cleanupCallbacks) {
      try {
        await callback();
      } catch (error) {
        console.error('[MemoryManager] 清理回调执行失败:', error);
      }
    }

    // 强制垃圾回收（如果可用）
    if (window.gc) {
      window.gc();
      console.log('[MemoryManager] 已执行垃圾回收');
    }
  }

  /**
   * 获取内存使用统计
   */
  getMemoryStats() {
    if (performance.memory) {
      const memInfo = performance.memory;
      return {
        used: memInfo.usedJSHeapSize,
        total: memInfo.totalJSHeapSize,
        limit: memInfo.jsHeapSizeLimit,
        usedMB: (memInfo.usedJSHeapSize / 1024 / 1024).toFixed(2),
        totalMB: (memInfo.totalJSHeapSize / 1024 / 1024).toFixed(2),
        limitMB: (memInfo.jsHeapSizeLimit / 1024 / 1024).toFixed(2),
      };
    }
    return null;
  }
}

/**
 * 数据流处理器
 * 用于处理大数据集的流式处理
 */
export class DataStreamProcessor {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 100;
    this.processingDelay = options.processingDelay || 10;
    this.maxConcurrency = options.maxConcurrency || 3;
  }

  /**
   * 分块处理大数组
   * @param {Array} data - 要处理的数据数组
   * @param {Function} processor - 处理函数
   * @param {Function} onProgress - 进度回调
   */
  async processInChunks(data, processor, onProgress = null) {
    const chunks = this.createChunks(data, this.chunkSize);
    const results = [];

    console.log(`[DataStreamProcessor] 开始分块处理，共 ${chunks.length} 个块`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      try {
        const chunkResults = await processor(chunk, i);
        results.push(...chunkResults);

        if (onProgress) {
          onProgress({
            processed: i + 1,
            total: chunks.length,
            percentage: (((i + 1) / chunks.length) * 100).toFixed(2),
          });
        }

        // 添加延迟以避免阻塞UI
        if (this.processingDelay > 0) {
          await this.delay(this.processingDelay);
        }
      } catch (error) {
        console.error(`[DataStreamProcessor] 处理第 ${i + 1} 块时出错:`, error);
        throw error;
      }
    }

    console.log(
      `[DataStreamProcessor] 分块处理完成，共处理 ${results.length} 项`
    );
    return results;
  }

  /**
   * 并发处理数据
   * @param {Array} data - 要处理的数据数组
   * @param {Function} processor - 处理函数
   * @param {Function} onProgress - 进度回调
   */
  async processConcurrently(data, processor, onProgress = null) {
    const chunks = this.createChunks(
      data,
      Math.ceil(data.length / this.maxConcurrency)
    );
    const results = [];

    console.log(
      `[DataStreamProcessor] 开始并发处理，并发度: ${this.maxConcurrency}`
    );

    const promises = chunks.map(async (chunk, index) => {
      try {
        const chunkResults = await processor(chunk, index);

        if (onProgress) {
          onProgress({
            chunkIndex: index,
            chunkSize: chunk.length,
            results: chunkResults.length,
          });
        }

        return chunkResults;
      } catch (error) {
        console.error(
          `[DataStreamProcessor] 并发处理块 ${index} 时出错:`,
          error
        );
        throw error;
      }
    });

    const chunkResults = await Promise.all(promises);
    chunkResults.forEach(chunkResult => results.push(...chunkResult));

    console.log(
      `[DataStreamProcessor] 并发处理完成，共处理 ${results.length} 项`
    );
    return results;
  }

  /**
   * 创建数据块
   * @param {Array} data - 原始数据
   * @param {number} size - 块大小
   */
  createChunks(data, size) {
    const chunks = [];
    for (let i = 0; i < data.length; i += size) {
      chunks.push(data.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 缓存管理器
 * 提供智能缓存和数据去重功能
 */
export class CacheManager {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 300000; // 5分钟默认TTL
    this.cache = new Map();
    this.accessTimes = new Map();
    this.cleanupInterval = null;
  }

  /**
   * 启动缓存清理
   */
  startCleanup(interval = 60000) {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, interval);
  }

  /**
   * 停止缓存清理
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 设置缓存项
   * @param {string} key - 缓存键
   * @param {*} value - 缓存值
   * @param {number} customTTL - 自定义TTL
   */
  set(key, value, customTTL = null) {
    const now = Date.now();
    const ttl = customTTL || this.ttl;

    this.cache.set(key, {
      value,
      timestamp: now,
      ttl,
      expires: now + ttl,
    });

    this.accessTimes.set(key, now);

    // 如果超过最大大小，清理最旧的项
    if (this.cache.size > this.maxSize) {
      this.evictOldest();
    }
  }

  /**
   * 获取缓存项
   * @param {string} key - 缓存键
   */
  get(key) {
    const item = this.cache.get(key);

    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      this.accessTimes.delete(key);
      return null;
    }

    // 更新访问时间
    this.accessTimes.set(key, Date.now());
    return item.value;
  }

  /**
   * 删除缓存项
   * @param {string} key - 缓存键
   */
  delete(key) {
    this.cache.delete(key);
    this.accessTimes.delete(key);
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.accessTimes.clear();
  }

  /**
   * 清理过期项
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
        this.accessTimes.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[CacheManager] 清理了 ${cleanedCount} 个过期缓存项`);
    }
  }

  /**
   * 驱逐最旧的项
   */
  evictOldest() {
    if (this.accessTimes.size === 0) return;

    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.accessTimes.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
      console.log(`[CacheManager] 驱逐最旧的缓存项: ${oldestKey}`);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.calculateHitRate(),
    };
  }

  /**
   * 计算命中率（简化版）
   */
  calculateHitRate() {
    // 这里可以实现更复杂的命中率计算
    return ((this.cache.size / this.maxSize) * 100).toFixed(2);
  }
}

// 创建全局实例
export const memoryManager = new MemoryManager();
export const dataStreamProcessor = new DataStreamProcessor();
export const cacheManager = new CacheManager();
