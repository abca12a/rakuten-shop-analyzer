// 导入模块
import {
  getProductsByShop,
  clearShopData,
  getHighResImages,
  getShopHighResImages,
} from './src/core/dataManager.js';
import { sendProgressToPopup, showNotification } from './js/utils.js';
import {
  taskStatus,
  saveTaskStatus,
  loadTaskStatus,
  getCurrentStatus,
  forceStopAllTasks,
  clearTaskStatus,
  validateTaskStatus,
} from './js/taskManager.js';
import {
  startBatchImageFetch,
  cancelBatchImageFetch,
  handleDetectedHighResImages,
  loadBatchImageFetchStatus,
  getBatchImageUrlData, // 🔧 新增：导入获取批量图片URL数据的函数
} from './js/batchImageFetcher.js';
import { executeScrapeShop } from './js/shopScraper.js';
import { ErrorHandler, ValidationError } from './src/utils/errorHandler.js';

const RAKUTEN_PROXY_BASE_URL = 'https://api.845817074.xyz';

// 创建Service Worker专用的错误处理器实例
const errorHandler = new ErrorHandler({
  enableNotifications: true,
  enableConsoleLog: true,
  enableRetry: true,
  maxRetries: 2,
  retryDelay: 1000,
});

// 初始化任务状态
async function initializeTaskStatus() {
  return await errorHandler.wrapAsync(
    async () => {
      console.log('正在加载保存的任务状态...');
      const batchStatus = await loadTaskStatus();

      // 如果有批量任务状态，加载到batchImageFetcher
      if (batchStatus) {
        await loadBatchImageFetchStatus(batchStatus);
      }

      console.log('任务状态初始化完成');
    },
    '初始化任务状态',
    {
      throwOnError: false,
      defaultValue: null,
    }
  );
}

// 加载保存的任务状态
initializeTaskStatus();

// 插件安装或更新时的处理
chrome.runtime.onInstalled.addListener(async details => {
  await errorHandler.wrapAsync(
    async () => {
      console.log('乐天店铺数据分析器已安装/更新:', details);

      // 首次安装时打开欢迎页面
      if (details.reason === 'install') {
        console.log('首次安装，打开欢迎页面');
        await chrome.tabs.create({
          url: chrome.runtime.getURL('welcome.html'),
        });
      }

      // 版本更新时的处理
      if (details.reason === 'update') {
        const previousVersion = details.previousVersion;
        const currentVersion = chrome.runtime.getManifest().version;
        console.log(`版本更新: ${previousVersion} -> ${currentVersion}`);

        // 清理错误历史（版本更新时）
        errorHandler.cleanupErrorHistory();
      }

      // 重新初始化任务状态
      await initializeTaskStatus();
    },
    '插件安装/更新处理',
    {
      throwOnError: false,
      defaultValue: null,
    }
  );
});

// 统一的消息处理器
class MessageHandler {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.activeRequests = new Map(); // 防止重复请求
  }

  handleMessage(message, sender, sendResponse) {
    console.log(`Service Worker收到消息:`, message, '来自:', sender);

    // 对于简单的同步操作，直接处理
    if (message.action === 'ping') {
      const response = {
        success: true,
        message: 'pong',
        timestamp: Date.now(),
        operation: 'ping',
      };
      console.log('Service Worker被ping唤醒');
      console.log('响应已发送:', {
        success: response.success,
        operation: response.operation,
        hasData: false,
        error: 'none',
      });
      sendResponse(response);
      return false; // 同步响应，不需要保持消息通道
    }

    // 对于异步操作，立即开始处理
    this._handleAsyncMessage(message, sender, sendResponse);
    return true; // 异步响应，保持消息通道开放
  }

  async _handleAsyncMessage(message, sender, sendResponse) {
    try {
      // 验证消息格式
      this.errorHandler.validateParams(message, {
        action: { required: true, type: 'string' },
      });

      // 防重复请求检查（仅对特定操作）
      const requestKey = this._getRequestKey(message);
      if (
        this._shouldPreventDuplicate(message.action) &&
        this.activeRequests.has(requestKey)
      ) {
        console.log(`[防重复] 检测到重复请求，忽略: ${requestKey}`);
        this._safeResponse(sendResponse, {
          success: true,
          message: '请求已在处理中，请勿重复操作',
          duplicate: true,
        });
        return;
      }

      // 标记请求为活跃状态
      if (this._shouldPreventDuplicate(message.action)) {
        this.activeRequests.set(requestKey, Date.now());
        console.log(`[防重复] 标记请求为活跃: ${requestKey}`);
      }

      const handler = this._getActionHandler(message.action);
      if (!handler) {
        throw new ValidationError(
          `未知操作: ${message.action}`,
          'action',
          message.action
        );
      }

      const result = await handler(message, sender);

      // 立即发送响应，不使用setTimeout
      this._safeResponse(sendResponse, result);

      // 清除活跃请求标记
      if (this._shouldPreventDuplicate(message.action)) {
        this.activeRequests.delete(requestKey);
        console.log(`[防重复] 清除请求标记: ${requestKey}`);
      }
    } catch (error) {
      const errorResponse = this.errorHandler.createErrorResponse(
        error,
        `处理消息 ${message?.action || 'unknown'}`
      );

      // 清除活跃请求标记（即使出错也要清除）
      const requestKey = this._getRequestKey(message);
      if (this._shouldPreventDuplicate(message.action)) {
        this.activeRequests.delete(requestKey);
        console.log(`[防重复] 错误时清除请求标记: ${requestKey}`);
      }

      // 立即发送错误响应
      this._safeResponse(sendResponse, errorResponse);
    }
  }

  _getActionHandler(action) {
    const handlers = {
      scrapeShop: this._handleScrapeShop.bind(this),
      stopScraping: this._handleStopScraping.bind(this),
      getShopData: this._handleGetShopData.bind(this),
      getProductsByShop: this._handleGetShopData.bind(this), // 添加缺失的处理器，使用相同的逻辑
      clearShopData: this._handleClearShopData.bind(this),
      detectedHighResImages: this._handleDetectedHighResImages.bind(this),
      getHighResImages: this._handleGetHighResImages.bind(this),
      getShopHighResImages: this._handleGetShopHighResImages.bind(this),
      getBatchImageUrlData: this._handleGetBatchImageUrlData.bind(this), // 🔧 新增：获取批量图片URL数据
      batchFetchHighResImages: this._handleBatchFetchHighResImages.bind(this),
      batchFetchImages: this._handleBatchFetchHighResImages.bind(this), // 添加别名支持
      cancelBatchImageFetch: this._handleCancelBatchImageFetch.bind(this),
      getCurrentStatus: this._handleGetCurrentStatus.bind(this),
      quickTest: this._handleQuickTest.bind(this), // 添加快速测试处理器
      // 新增任务管理API
      forceStopAllTasks: this._handleForceStopAllTasks.bind(this),
      clearTaskStatus: this._handleClearTaskStatus.bind(this),
      validateTaskStatus: this._handleValidateTaskStatus.bind(this),
    };
    return handlers[action];
  }

  _safeResponse(sendResponse, response) {
    try {
      // 检查sendResponse是否仍然有效
      if (typeof sendResponse === 'function') {
        sendResponse(response);
        console.log('响应已发送:', {
          success: response.success,
          operation: response.operation || 'unknown',
          hasData: !!response.data,
          error: response.error || 'none',
        });
      } else {
        console.warn('sendResponse 不是有效的函数');
      }
    } catch (e) {
      // 如果是端口关闭错误，记录但不抛出
      if (e.message && e.message.includes('message port closed')) {
        console.log('消息端口已关闭，可能是Popup窗口被关闭了');
      } else {
        console.warn('发送响应时出错:', e);
      }
    }
  }

  // 防重复请求的辅助方法
  _getRequestKey(message) {
    // 为不同类型的操作生成唯一键
    switch (message.action) {
      case 'scrapeShop':
        return `scrapeShop:${message.shopCode}`;
      case 'batchFetchHighResImages':
      case 'batchFetchImages': // 添加别名支持
        return `batchFetch:${message.shopCode}:${message.fetchMode}`;
      default:
        return `${message.action}:${message.shopCode || 'global'}`;
    }
  }

  _shouldPreventDuplicate(action) {
    // 只对这些操作进行防重复检查
    const preventDuplicateActions = [
      'scrapeShop',
      'batchFetchHighResImages',
      'batchFetchImages', // 添加别名支持
    ];
    return preventDuplicateActions.includes(action);
  }

  async _handleScrapeShop(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
    });

    const {
      shopCode,
      fetchRanking = true,
      fetchTags = true,
      rankingMode = 'safe',
    } = message;

    // 初始化任务状态
    taskStatus.inProgress = true;
    taskStatus.lastShopCode = shopCode;
    taskStatus.lastTaskCompleted = false;
    taskStatus.lastTaskResult = null;
    taskStatus.lastTaskError = null;
    taskStatus.shouldStop = false; // 添加停止标志
    saveTaskStatus();

    return await this.errorHandler.wrapAsync(
      () =>
        executeScrapeShop(
          shopCode,
          fetchRanking,
          fetchTags,
          { mode: rankingMode },
          taskStatus,
          saveTaskStatus,
          sendProgressToPopup,
          showNotification
        ),
      '店铺数据抓取',
      {
        throwOnError: false,
        defaultValue: { success: false, error: '抓取失败' },
      }
    );
  }

  async _handleStopScraping() {
    console.log('=== 收到停止抓取请求 ===');

    // 设置停止标志
    taskStatus.shouldStop = true;
    taskStatus.inProgress = false;
    saveTaskStatus();

    return this.errorHandler.createSuccessResponse(
      { stopped: true },
      '停止抓取',
      { message: '抓取已停止' }
    );
  }

  async _handleGetShopData(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
    });

    const products = await this.errorHandler.wrapAsync(
      () => getProductsByShop(message.shopCode),
      '获取店铺数据',
      { throwOnError: false, defaultValue: null }
    );

    if (products) {
      return this.errorHandler.createSuccessResponse(products, '获取店铺数据');
    } else {
      return this.errorHandler.createErrorResponse(
        new Error('未找到数据'),
        '获取店铺数据'
      );
    }
  }

  async _handleClearShopData(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
    });

    const result = await this.errorHandler.wrapAsync(
      () => clearShopData(message.shopCode),
      '清除店铺数据'
    );

    return this.errorHandler.createSuccessResponse(result, '清除店铺数据', {
      message: `店铺 ${message.shopCode} 的数据已清除。`,
    });
  }

  async _handleDetectedHighResImages(message, sender) {
    // 直接调用原有的处理函数，它已经有自己的错误处理
    return new Promise(resolve => {
      handleDetectedHighResImages(message, sender, resolve);
    });
  }

  async _handleGetHighResImages(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
      itemCode: { required: true, type: 'string', minLength: 1 },
    });

    const result = await this.errorHandler.wrapAsync(
      () => getHighResImages(message.shopCode, message.itemCode),
      '获取高分辨率图片',
      { throwOnError: false, defaultValue: null }
    );

    if (result) {
      return this.errorHandler.createSuccessResponse(
        result,
        '获取高分辨率图片'
      );
    } else {
      return this.errorHandler.createErrorResponse(
        new Error('未找到高分辨率图片数据'),
        '获取高分辨率图片'
      );
    }
  }

  async _handleGetShopHighResImages(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
    });

    const result = await this.errorHandler.wrapAsync(
      () => getShopHighResImages(message.shopCode),
      '获取店铺高分辨率图片',
      { throwOnError: false, defaultValue: {} }
    );

    return this.errorHandler.createSuccessResponse(
      result,
      '获取店铺高分辨率图片'
    );
  }

  // 🔧 新增：获取批量图片URL数据的处理函数
  async _handleGetBatchImageUrlData(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
    });

    const result = await this.errorHandler.wrapAsync(
      () => getBatchImageUrlData(message.shopCode),
      '获取批量图片URL数据',
      { throwOnError: false, defaultValue: null }
    );

    if (result === null || (Array.isArray(result) && result.length === 0)) {
      return this.errorHandler.createErrorResponse(
        'NOT_FOUND',
        '获取批量图片URL数据',
        `未找到店铺 ${message.shopCode} 的批量图片URL数据`
      );
    }

    return this.errorHandler.createSuccessResponse(
      result,
      '获取批量图片URL数据'
    );
  }

  async _handleBatchFetchHighResImages(message) {
    this.errorHandler.validateParams(message, {
      shopCode: { required: true, type: 'string', minLength: 1 },
    });

    const {
      shopCode,
      maxConcurrent = 1,
      fetchMode = 'download_files',
      autoCloseDelay = 7000,
    } = message;

    console.log(
      `SW: batchFetchHighResImages received. Shop: ${shopCode}, Mode: ${fetchMode}, Delay: ${autoCloseDelay}, MaxConcurrent: ${maxConcurrent}`
    );

    return await this.errorHandler.wrapAsync(
      () =>
        startBatchImageFetch(shopCode, {
          maxConcurrent,
          fetchMode,
          autoCloseDelay,
        }),
      '批量抓取高分辨率图片',
      {
        throwOnError: false,
        defaultValue: { success: false, error: '启动批量图片任务失败' },
      }
    );
  }

  async _handleCancelBatchImageFetch() {
    return await this.errorHandler.wrapAsync(
      () => cancelBatchImageFetch(),
      '取消批量图片抓取',
      {
        throwOnError: false,
        defaultValue: { success: false, error: '取消批量抓取失败' },
      }
    );
  }

  async _handleGetCurrentStatus() {
    return this.errorHandler.createSuccessResponse(
      getCurrentStatus(),
      '获取当前状态'
    );
  }

  async _handleQuickTest() {
    return await this.errorHandler.wrapAsync(
      async () => {
        const testResults = [];
        const parseJsonSafely = text => {
          if (!text) return null;
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        };

        // 1. 固定服务器模式
        try {
          testResults.push(
            `✓ 固定服务器模式已启用 (${RAKUTEN_PROXY_BASE_URL})`
          );
        } catch (error) {
          testResults.push(`✗ 固定服务器模式异常: ${error.message}`);
        }

        // 2. 测试存储系统
        try {
          await chrome.storage.local.set({ quickTest: Date.now() });
          const result = await chrome.storage.local.get(['quickTest']);
          if (result.quickTest) {
            testResults.push('✓ 存储系统正常');
            await chrome.storage.local.remove(['quickTest']);
          } else {
            throw new Error('存储测试失败');
          }
        } catch (error) {
          testResults.push(`✗ 存储系统错误: ${error.message}`);
        }

        // 3. 测试服务器健康状态
        try {
          const response = await fetch(`${RAKUTEN_PROXY_BASE_URL}/health`, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          });

          const responseText = await response.text();
          const responseData = parseJsonSafely(responseText);

          if (!response.ok) {
            throw new Error(
              `健康检查失败: HTTP ${response.status}${responseData?.error ? `: ${responseData.error}` : ''}`
            );
          }

          testResults.push(
            `✓ 服务器连接正常 (${responseData?.service || 'rakuten-proxy'})`
          );
        } catch (error) {
          testResults.push(`✗ 服务器连接错误: ${error.message}`);
        }

        // 4. 测试 Rakuten 代理链路
        try {
          const response = await fetch(
            `${RAKUTEN_PROXY_BASE_URL}/rakuten/proxy?endpoint=${encodeURIComponent('IchibaItem/Search/20220601')}&shopCode=test&hits=1&page=1&imageFlag=1&formatVersion=2`,
            {
              method: 'GET',
              headers: {
                Accept: 'application/json',
              },
            }
          );

          const responseText = await response.text();
          const responseData = parseJsonSafely(responseText);
          const apiErrorDescription =
            responseData?.error_description ||
            responseData?.errors?.errorMessage ||
            responseData?.message ||
            responseData?.error ||
            '';

          if (response.status === 400 || response.status === 404) {
            testResults.push(
              `✓ Rakuten 代理链路正常 (测试参数无效: ${apiErrorDescription || `HTTP ${response.status}`})`
            );
          } else if (response.status === 401 || response.status === 403 || response.status === 502) {
            throw new Error(
              `代理鉴权或上游权限不足 (HTTP ${response.status}${apiErrorDescription ? `: ${apiErrorDescription}` : ''})`
            );
          } else if (response.ok) {
            testResults.push('✓ Rakuten 代理链路正常');
          } else {
            throw new Error(
              `HTTP ${response.status}: ${apiErrorDescription || response.statusText}`
            );
          }
        } catch (error) {
          testResults.push(`✗ Rakuten 代理链路错误: ${error.message}`);
        }

        return {
          success: true,
          testResults: testResults,
          timestamp: new Date().toISOString(),
        };
      },
      '系统快速测试',
      {
        throwOnError: false,
        defaultValue: {
          success: false,
          error: '系统测试失败',
          testResults: ['✗ 测试过程中发生错误'],
        },
      }
    );
  }

  // 新增处理器：强制停止所有任务
  async _handleForceStopAllTasks() {
    return await this.errorHandler.wrapAsync(
      async () => {
        console.log('收到强制停止所有任务请求');
        const result = await forceStopAllTasks();
        
        return {
          success: result.success,
          message: result.message,
          error: result.error,
          operation: 'forceStopAllTasks'
        };
      },
      '强制停止所有任务',
      {
        throwOnError: false,
        defaultValue: {
          success: false,
          error: '强制停止任务失败',
        },
      }
    );
  }

  // 新增处理器：清理任务状态
  async _handleClearTaskStatus() {
    return await this.errorHandler.wrapAsync(
      async () => {
        console.log('收到清理任务状态请求');
        await clearTaskStatus();
        
        return {
          success: true,
          message: '任务状态已清理',
          operation: 'clearTaskStatus'
        };
      },
      '清理任务状态',
      {
        throwOnError: false,
        defaultValue: {
          success: false,
          error: '清理任务状态失败',
        },
      }
    );
  }

  // 新增处理器：验证任务状态
  async _handleValidateTaskStatus() {
    return await this.errorHandler.wrapAsync(
      async () => {
        console.log('收到验证任务状态请求');
        const result = await validateTaskStatus();
        
        return {
          success: true,
          data: result,
          operation: 'validateTaskStatus'
        };
      },
      '验证任务状态',
      {
        throwOnError: false,
        defaultValue: {
          success: false,
          error: '验证任务状态失败',
        },
      }
    );
  }
}

// 创建消息处理器实例并设置监听器
const messageHandler = new MessageHandler(errorHandler);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  return messageHandler.handleMessage(message, sender, sendResponse);
});

console.log('Service Worker (主文件) 已启动并模块化。现在更简洁了！');
