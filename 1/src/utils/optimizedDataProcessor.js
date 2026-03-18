/**
 * 优化的数据处理模块
 * 提供高效的大数据处理和内存优化功能
 */

import { dataStreamProcessor } from './performanceOptimizer.js';

/**
 * 优化的CSV生成器
 * 使用流式处理避免内存溢出
 */
export class OptimizedCSVGenerator {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 50;
    this.maxMemoryUsage = options.maxMemoryUsage || 10 * 1024 * 1024; // 10MB
  }

  /**
   * 生成CSV内容（流式处理）
   * @param {Array} data - 数据数组
   * @param {Function} onProgress - 进度回调
   */
  async generateCSVStream(data, onProgress = null) {
    console.log(
      `[OptimizedCSVGenerator] 开始流式生成CSV，数据量: ${data.length}`
    );

    const header = 'ShopCode,ItemCode,ItemName,ImageURL,ImageIndex\n';
    const chunks = [];
    let totalUrls = 0;

    // 分块处理数据
    const processChunk = async chunk => {
      let csvChunk = '';
      let chunkUrls = 0;

      chunk.forEach(item => {
        const itemNameClean = this.cleanCSVField(item.itemName);
        const itemCodeClean = this.cleanCSVField(item.itemCode);
        const shopCodeClean = this.cleanCSVField(item.shopCode);

        if (item.urls && item.urls.length > 0) {
          item.urls.forEach((imageUrl, index) => {
            const imageUrlClean = this.cleanCSVField(imageUrl);
            csvChunk += `"${shopCodeClean}","${itemCodeClean}","${itemNameClean}","${imageUrlClean}","${index + 1}"\n`;
            chunkUrls++;
          });
        } else {
          csvChunk += `"${shopCodeClean}","${itemCodeClean}","${itemNameClean}","","0"\n`;
        }
      });

      return { csvChunk, urlCount: chunkUrls };
    };

    // 使用数据流处理器分块处理
    await dataStreamProcessor.processInChunks(
      data,
      async (chunk, chunkIndex) => {
        const result = await processChunk(chunk, chunkIndex);
        chunks.push(result.csvChunk);
        totalUrls += result.urlCount;

        if (onProgress) {
          onProgress({
            phase: 'processing',
            processed: chunkIndex + 1,
            total: Math.ceil(data.length / this.chunkSize),
            urlsProcessed: totalUrls,
          });
        }

        return [result];
      },
      onProgress
    );

    // 组装最终CSV
    if (onProgress) {
      onProgress({ phase: 'assembling', message: '正在组装CSV内容...' });
    }

    const finalCSV = header + chunks.join('');

    console.log(
      `[OptimizedCSVGenerator] CSV生成完成，共 ${totalUrls} 行数据，大小: ${(finalCSV.length / 1024).toFixed(2)}KB`
    );

    return {
      csvContent: finalCSV,
      totalUrls,
      size: finalCSV.length,
    };
  }

  /**
   * 清理CSV字段
   * @param {string} field - 字段值
   */
  cleanCSVField(field) {
    if (!field) return '';
    return field.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, ' ');
  }
}

/**
 * 优化的图片处理器
 * 提供高效的图片数据处理和去重
 */
export class OptimizedImageProcessor {
  constructor() {
    this.urlCache = new Set(); // 用于快速去重
    this.processedCount = 0;
  }

  /**
   * 批量处理图片数据
   * @param {Array} images - 图片数组
   * @param {Object} options - 处理选项
   */
  async processImages(images, options = {}) {
    const {
      enableDeduplication = true,
      enableValidation = true,
      onProgress = null,
    } = options;

    console.log(`[OptimizedImageProcessor] 开始处理 ${images.length} 张图片`);

    const processChunk = async chunk => {
      const validImages = [];

      for (const imageData of chunk) {
        try {
          const processedImage = await this.processImage(
            imageData,
            enableDeduplication,
            enableValidation
          );

          if (processedImage) {
            validImages.push(processedImage);
          }
        } catch (error) {
          console.error('[OptimizedImageProcessor] 处理图片时出错:', error);
        }
      }

      this.processedCount += chunk.length;

      if (onProgress) {
        onProgress({
          processed: this.processedCount,
          total: images.length,
          validCount: validImages.length,
        });
      }

      return validImages;
    };

    const results = await dataStreamProcessor.processInChunks(
      images,
      processChunk,
      onProgress
    );

    const finalResults = results.flat();
    console.log(
      `[OptimizedImageProcessor] 处理完成，有效图片: ${finalResults.length}/${images.length}`
    );

    return finalResults;
  }

  /**
   * 处理单张图片
   * @param {Object} imageData - 图片数据
   * @param {boolean} enableDeduplication - 是否启用去重
   * @param {boolean} enableValidation - 是否启用验证
   */
  async processImage(imageData, enableDeduplication, enableValidation) {
    let imageUrl;

    // 提取URL
    if (typeof imageData === 'string') {
      imageUrl = imageData;
    } else if (imageData && typeof imageData === 'object' && imageData.url) {
      imageUrl = imageData.url;
    } else {
      return null;
    }

    // 去重检查
    if (enableDeduplication && this.urlCache.has(imageUrl)) {
      return null;
    }

    // 验证URL
    if (enableValidation && !this.isValidImageUrl(imageUrl)) {
      return null;
    }

    // 添加到缓存
    if (enableDeduplication) {
      this.urlCache.add(imageUrl);
    }

    // 返回标准化的图片对象
    return {
      url: imageUrl,
      width: imageData.width || 0,
      height: imageData.height || 0,
      isGoldShop: imageData.isGoldShop || false,
      isEstimated: imageData.isEstimated || false,
      loadFailed: imageData.loadFailed || false,
    };
  }

  /**
   * 验证图片URL
   * @param {string} url - 图片URL
   */
  isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;

    try {
      new URL(url);
      return url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i) !== null;
    } catch {
      return false;
    }
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.urlCache.clear();
    this.processedCount = 0;
  }

  /**
   * 获取处理统计
   */
  getStats() {
    return {
      cacheSize: this.urlCache.size,
      processedCount: this.processedCount,
    };
  }
}

/**
 * 优化的存储管理器
 * 提供分批存储和压缩功能
 */
export class OptimizedStorageManager {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 100;
    this.compressionEnabled = options.compressionEnabled || false;
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * 分批保存数据
   * @param {string} baseKey - 基础键名
   * @param {Array} data - 要保存的数据
   * @param {Function} onProgress - 进度回调
   */
  async saveBatched(baseKey, data, onProgress = null) {
    console.log(
      `[OptimizedStorageManager] 开始分批保存数据，总量: ${data.length}`
    );

    const batches = this.createBatches(data, this.batchSize);
    const savedBatches = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchKey = `${baseKey}_batch_${i}`;

      try {
        await this.saveWithRetry(batchKey, batch);
        savedBatches.push(batchKey);

        if (onProgress) {
          onProgress({
            batch: i + 1,
            total: batches.length,
            saved: savedBatches.length,
          });
        }
      } catch (error) {
        console.error(`[OptimizedStorageManager] 保存批次 ${i} 失败:`, error);
        throw error;
      }
    }

    // 保存批次索引
    await this.saveWithRetry(`${baseKey}_index`, {
      batches: savedBatches,
      totalItems: data.length,
      timestamp: Date.now(),
    });

    console.log(
      `[OptimizedStorageManager] 分批保存完成，共 ${batches.length} 个批次`
    );
    return savedBatches;
  }

  /**
   * 分批加载数据
   * @param {string} baseKey - 基础键名
   * @param {Function} onProgress - 进度回调
   */
  async loadBatched(baseKey, onProgress = null) {
    console.log(`[OptimizedStorageManager] 开始分批加载数据: ${baseKey}`);

    try {
      // 加载索引
      const index = await this.loadWithRetry(`${baseKey}_index`);
      if (!index || !index.batches) {
        console.log(`[OptimizedStorageManager] 未找到索引: ${baseKey}_index`);
        return null;
      }

      const allData = [];

      for (let i = 0; i < index.batches.length; i++) {
        const batchKey = index.batches[i];

        try {
          const batchData = await this.loadWithRetry(batchKey);
          if (batchData) {
            allData.push(...batchData);
          }

          if (onProgress) {
            onProgress({
              batch: i + 1,
              total: index.batches.length,
              loaded: allData.length,
            });
          }
        } catch (error) {
          console.error(
            `[OptimizedStorageManager] 加载批次 ${batchKey} 失败:`,
            error
          );
        }
      }

      console.log(
        `[OptimizedStorageManager] 分批加载完成，共 ${allData.length} 项`
      );
      return allData;
    } catch (error) {
      console.error(`[OptimizedStorageManager] 分批加载失败:`, error);
      throw error;
    }
  }

  /**
   * 创建数据批次
   * @param {Array} data - 原始数据
   * @param {number} size - 批次大小
   */
  createBatches(data, size) {
    const batches = [];
    for (let i = 0; i < data.length; i += size) {
      batches.push(data.slice(i, i + size));
    }
    return batches;
  }

  /**
   * 带重试的保存
   * @param {string} key - 键名
   * @param {*} data - 数据
   */
  async saveWithRetry(key, data) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await chrome.storage.local.set({ [key]: data });
        return;
      } catch (error) {
        console.warn(
          `[OptimizedStorageManager] 保存尝试 ${attempt}/${this.maxRetries} 失败:`,
          error
        );

        if (attempt === this.maxRetries) {
          throw error;
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * 带重试的加载
   * @param {string} key - 键名
   */
  async loadWithRetry(key) {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await chrome.storage.local.get(key);
        return result[key];
      } catch (error) {
        console.warn(
          `[OptimizedStorageManager] 加载尝试 ${attempt}/${this.maxRetries} 失败:`,
          error
        );

        if (attempt === this.maxRetries) {
          throw error;
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * 清理批次数据
   * @param {string} baseKey - 基础键名
   */
  async cleanupBatches(baseKey) {
    try {
      const index = await this.loadWithRetry(`${baseKey}_index`);
      if (index && index.batches) {
        // 删除所有批次
        for (const batchKey of index.batches) {
          await chrome.storage.local.remove(batchKey);
        }

        // 删除索引
        await chrome.storage.local.remove(`${baseKey}_index`);

        console.log(`[OptimizedStorageManager] 清理完成: ${baseKey}`);
      }
    } catch (error) {
      console.error(`[OptimizedStorageManager] 清理失败:`, error);
    }
  }
}

// 创建全局实例
export const optimizedCSVGenerator = new OptimizedCSVGenerator();
export const optimizedImageProcessor = new OptimizedImageProcessor();
export const optimizedStorageManager = new OptimizedStorageManager();
