// 导入依赖
import { sendProgressToPopup, showNotification } from './utils.js';
import {
  getProductsByShop,
  saveHighResImages,
  saveBatchImageUrlData,
  loadBatchImageUrlData,
  clearBatchImageUrlData,
} from '../src/core/dataManager.js'; // 注意路径调整
import { saveTaskStatus, setBatchImageFetchStatus } from './taskManager.js';
import { memoryManager } from '../src/utils/performanceOptimizer.js';

// 统一错误处理类
class BatchImageError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = null) {
    super(message);
    this.name = 'BatchImageError';
    this.code = code;
    this.details = details;
  }
}

// 批量图片抓取错误处理工具
const BatchErrorHandler = {
  async wrapAsync(fn, errorCode, errorMessage) {
    try {
      return await fn();
    } catch (error) {
      console.error(`[${errorCode}] ${errorMessage}:`, error);
      throw new BatchImageError(
        `${errorMessage}: ${error.message}`,
        errorCode,
        error
      );
    }
  },

  handleResponse(response, operation) {
    if (!response) {
      throw new BatchImageError(`${operation}失败: 未收到响应`, 'NO_RESPONSE');
    }
    if (!response.success) {
      throw new BatchImageError(
        `${operation}失败: ${response.error || '未知错误'}`,
        'OPERATION_FAILED',
        response
      );
    }
    return response;
  },
};

// 批量图片抓取相关状态
const batchImageFetchStatus = {
  isRunning: false,
  shopCode: null,
  products: [],
  totalProducts: 0,
  currentIndex: 0,
  processedCount: 0,
  extractedCount: 0,
  downloadSuccessCount: 0, // 🔧 新增：下载成功计数
  downloadFailureCount: 0, // 🔧 新增：下载失败计数
  maxConcurrent: 1,
  autoCloseDelay: 12000, // 默认单页等待时间，会被 options 覆盖
  tabIds: [],
  fetchMode: 'download_files', // 默认模式改为 download_files, 会被options覆盖
  imageUrlCsvData: [],
};

// 设置状态引用到taskManager
setBatchImageFetchStatus(batchImageFetchStatus);

async function persistBatchImageUrlData(shopCode = batchImageFetchStatus.shopCode) {
  if (!shopCode || !Array.isArray(batchImageFetchStatus.imageUrlCsvData)) {
    return;
  }

  await saveBatchImageUrlData(shopCode, batchImageFetchStatus.imageUrlCsvData);
}

// 加载保存的批量任务状态
export async function loadBatchImageFetchStatus(savedStatus) {
  if (savedStatus) {
    Object.assign(batchImageFetchStatus, savedStatus);

    // 清理无效的标签页ID（重启后无效）
    if (batchImageFetchStatus.tabIds && batchImageFetchStatus.tabIds.length > 0) {
      console.log(`[状态恢复] 清理 ${batchImageFetchStatus.tabIds.length} 个无效的标签页ID`);
      batchImageFetchStatus.tabIds = [];
    }

    // 如果有运行中的批量任务，重新加载商品数据
    if (batchImageFetchStatus.isRunning && batchImageFetchStatus.shopCode) {
      try {
        const products = await getProductsByShop(
          batchImageFetchStatus.shopCode
        );
        if (products) {
          batchImageFetchStatus.products = products;
          batchImageFetchStatus.totalProducts = products.length;
          console.log(
            `[状态恢复] 重新加载了店铺 ${batchImageFetchStatus.shopCode} 的 ${products.length} 个商品数据`
          );

          // 检查任务是否已经完成
          if (batchImageFetchStatus.processedCount >= batchImageFetchStatus.totalProducts) {
            console.log(`[状态恢复] 检测到任务已完成，停止运行状态`);
            batchImageFetchStatus.isRunning = false;
            await saveTaskStatus();
          }
        } else {
          // 如果无法加载商品数据，停止任务
          console.warn(
            `[状态恢复] 无法加载店铺 ${batchImageFetchStatus.shopCode} 的商品数据，停止批量任务`
          );
          batchImageFetchStatus.isRunning = false;
          await saveTaskStatus();
        }
      } catch (error) {
        console.error(`[状态恢复] 加载商品数据失败:`, error);
        batchImageFetchStatus.isRunning = false;
        await saveTaskStatus();
      }
    }

    console.log('[状态恢复] 批量图片抓取状态已恢复:', batchImageFetchStatus);
  }
}

// 导出状态供外部访问
export function getBatchImageFetchStatus() {
  return batchImageFetchStatus;
}

// Helper function to get original filename from URL and ensure an extension
function getOriginalFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    let filename = urlObj.pathname.substring(
      urlObj.pathname.lastIndexOf('/') + 1
    );

    // If filename is empty (e.g. URL ends with /), try to generate a name or use a default
    if (!filename) {
      // Try to get a name from a common query parameter if one exists
      const queryParams = new URLSearchParams(urlObj.search);
      const nameParam = ['img', 'file', 'name', 'image_name'].find(p =>
        queryParams.has(p)
      );
      if (nameParam) {
        filename = queryParams.get(nameParam);
      } else {
        // 使用更有意义的文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        filename = `rakuten_image_${timestamp}_${Date.now()}`;
      }
    }

    // 移除查询参数（如 ?v=123）
    if (filename.includes('?')) {
      filename = filename.split('?')[0];
    }

    // 确保文件名有扩展名，改进扩展名检测逻辑
    if (!/\.(jpg|jpeg|png|gif|webp|avif|tiff|bmp)$/i.test(filename)) {
      // 优先从URL路径中查找扩展名
      const pathExtensions = url.match(/\.(jpg|jpeg|png|gif|webp|avif|tiff|bmp)/gi);
      if (pathExtensions && pathExtensions.length > 0) {
        filename += pathExtensions[pathExtensions.length - 1].toLowerCase();
      } 
      // 其次从URL整体查找
      else if (url.toLowerCase().includes('.png')) filename += '.png';
      else if (url.toLowerCase().includes('.gif')) filename += '.gif';
      else if (url.toLowerCase().includes('.webp')) filename += '.webp';
      else if (url.toLowerCase().includes('.jpeg')) filename += '.jpeg';
      else if (url.toLowerCase().includes('.avif')) filename += '.avif';
      else if (url.toLowerCase().includes('.tiff')) filename += '.tiff';
      // 默认扩展名
      else filename += '.jpg';
    }

    // 清理文件名中的非法字符
    filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    
    // 限制文件名长度
    const maxLength = 100;
    if (filename.length > maxLength) {
      const ext = filename.substring(filename.lastIndexOf('.'));
      const name = filename.substring(0, filename.lastIndexOf('.'));
      filename = name.substring(0, maxLength - ext.length - 3) + '...' + ext;
    }
    
    return decodeURIComponent(filename);
  } catch (e) {
    console.warn('Error parsing URL for filename:', url, e);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_');
    return `rakuten_image_${timestamp}.jpg`; // Fallback for invalid URLs
  }
}

// Helper function to sanitize path components
function sanitizePathComponent(component) {
  if (typeof component !== 'string') component = String(component);
  let sanitized = component.replace(/[:]/g, '_'); // Replace colons, common in itemCode
  sanitized = sanitized.replace(/[<>"/\\|?*]/g, ''); // Remove other Windows & Unix special characters (simplified)
  sanitized = sanitized.replace(/\\0/g, ''); // Remove null characters
  sanitized = sanitized.substring(0, 100); // Limit length of each path component
  return sanitized;
}

// 发送批量图片抓取进度消息 (内部函数)
async function sendBatchImageProgress() {
  try {
    // 计算额外的统计信息
    const progressPercent = batchImageFetchStatus.totalProducts > 0 
      ? Math.round((batchImageFetchStatus.processedCount / batchImageFetchStatus.totalProducts) * 100) 
      : 0;
    
    const extractionRate = batchImageFetchStatus.processedCount > 0 
      ? Math.round((batchImageFetchStatus.extractedCount / batchImageFetchStatus.processedCount) * 100) 
      : 0;

    await chrome.runtime.sendMessage({
      action: 'batchImageProgress',
      shopCode: batchImageFetchStatus.shopCode,
      current: batchImageFetchStatus.processedCount,
      total: batchImageFetchStatus.totalProducts,
      extractedCount: batchImageFetchStatus.extractedCount,
      fetchMode: batchImageFetchStatus.fetchMode,
      // 新增详细进度信息
      progressPercent: progressPercent,
      extractionRate: extractionRate,
      remainingProducts: batchImageFetchStatus.totalProducts - batchImageFetchStatus.processedCount,
      activeTabsCount: batchImageFetchStatus.tabIds ? batchImageFetchStatus.tabIds.length : 0,
      estimatedTimeRemaining: _estimateTimeRemaining(),
      statusMessage: _getProgressStatusMessage()
    });
  } catch (error) {
    if (
      error.message.includes(
        'Could not establish connection. Receiving end does not exist.'
      )
    ) {
      console.log(
        `批量图片抓取进度: ${batchImageFetchStatus.processedCount}/${batchImageFetchStatus.totalProducts} (${progressPercent}%)，已提取:${batchImageFetchStatus.extractedCount} (Popup not open)`
      );
    } else {
      console.error(
        '发送批量图片进度消息出错 (sendBatchImageProgress - batchImageFetcher):',
        error
      );
    }
  }
}

// 估算剩余时间
function _estimateTimeRemaining() {
  if (!batchImageFetchStatus.startTime || batchImageFetchStatus.processedCount === 0) {
    return '计算中...';
  }
  
  const elapsed = Date.now() - batchImageFetchStatus.startTime;
  const avgTimePerProduct = elapsed / batchImageFetchStatus.processedCount;
  const remaining = batchImageFetchStatus.totalProducts - batchImageFetchStatus.processedCount;
  const estimatedMs = remaining * avgTimePerProduct;
  
  if (estimatedMs < 60000) {
    return `约 ${Math.round(estimatedMs / 1000)} 秒`;
  } else if (estimatedMs < 3600000) {
    return `约 ${Math.round(estimatedMs / 60000)} 分钟`;
  } else {
    return `约 ${Math.round(estimatedMs / 3600000)} 小时`;
  }
}

// 获取进度状态消息
function _getProgressStatusMessage() {
  const { processedCount, totalProducts, extractedCount, fetchMode, tabIds } = batchImageFetchStatus;
  
  if (processedCount === 0) {
    return '正在启动批量抓取...';
  } else if (processedCount === totalProducts) {
    const modeText = fetchMode === 'download_files' ? '下载' : (fetchMode === 'url_only' ? 'URL提取' : '存储');
    return `${modeText}完成！共处理 ${extractedCount} 个商品的图片`;
  } else {
    const activeTabsText = tabIds && tabIds.length > 0 ? `，${tabIds.length} 个页面处理中` : '';
    return `正在处理第 ${processedCount + 1} 个商品${activeTabsText}`;
  }
}

// 批量抓取高分辨率图片任务
export async function startBatchImageFetch(shopCode, options = {}) {
  if (batchImageFetchStatus.isRunning) {
    console.log('批量图片抓取任务已在运行中，请等待完成或刷新页面重试');
    return { success: false, error: '批量图片抓取任务已在运行中' };
  }
  try {
    const products = await getProductsByShop(shopCode);
    if (!products || products.length === 0) {
      return {
        success: false,
        error: `未找到店铺 ${shopCode} 的产品数据，请先抓取商品信息`,
      };
    }

    await clearBatchImageUrlData(shopCode);

    Object.assign(batchImageFetchStatus, {
      isRunning: true,
      shopCode: shopCode,
      products: products,
      totalProducts: products.length,
      currentIndex: 0,
      processedCount: 0,
      extractedCount: 0,
      downloadSuccessCount: 0, // 🔧 修复：重置下载成功计数
      downloadFailureCount: 0, // 🔧 修复：重置下载失败计数
      maxConcurrent: options.maxConcurrent || 1,
      autoCloseDelay: options.autoCloseDelay || 12000, // 从 options 获取，默认 12000ms
      tabIds: [],
      fetchMode: options.fetchMode || 'download_files', // 从options获取，默认为 'download_files'
      imageUrlCsvData: [], // 每次开始时清空
      startTime: Date.now(), // 添加开始时间
    });
    console.log(
      `开始批量抓取店铺 ${shopCode} (模式: ${batchImageFetchStatus.fetchMode})，共 ${products.length} 个商品`
    );
    sendProgressToPopup(
      `批量抓取任务开始 (模式: ${batchImageFetchStatus.fetchMode})，店铺: ${shopCode}，共 ${products.length} 个商品。`
    );

    // 启动内存监控
    memoryManager.startMonitoring(30000); // 每30秒检查一次
    memoryManager.registerCleanupCallback(async () => {
      console.log('[内存管理] 执行批量图片抓取内存清理');
      // 清理imageUrlCsvData中的旧数据
      if (batchImageFetchStatus.imageUrlCsvData.length > 1000) {
        const keepCount = 500;
        batchImageFetchStatus.imageUrlCsvData =
          batchImageFetchStatus.imageUrlCsvData.slice(-keepCount);
        console.log(
          `[内存管理] 清理了 ${batchImageFetchStatus.imageUrlCsvData.length - keepCount} 条图片URL数据`
        );
      }
    });

    // 保存状态
    await saveTaskStatus();

    processBatchImageQueue();
    return {
      success: true,
      totalProducts: products.length,
      fetchMode: batchImageFetchStatus.fetchMode,
    };
  } catch (error) {
    console.error('启动批量抓取图片任务出错:', error);
    batchImageFetchStatus.isRunning = false;
    return {
      success: false,
      error: error.message || '启动批量抓取图片任务时出现未知错误',
    };
  }
}

// 处理批量图片抓取队列 (内部函数)
async function processBatchImageQueue() {
  if (
    !batchImageFetchStatus.isRunning ||
    (batchImageFetchStatus.currentIndex >=
      batchImageFetchStatus.totalProducts &&
      batchImageFetchStatus.tabIds.length === 0)
  ) {
    if (batchImageFetchStatus.isRunning) {
      console.log(
        `[批量抓取] 所有标签页已处理或关闭，当前索引: ${batchImageFetchStatus.currentIndex}, 总产品数: ${batchImageFetchStatus.totalProducts}`
      );
      completeBatchImageFetch();
    }
    return;
  }
  if (
    batchImageFetchStatus.tabIds.length >= batchImageFetchStatus.maxConcurrent
  ) {
    console.log(
      `[批量抓取] 已达到最大并发标签页数 (${batchImageFetchStatus.maxConcurrent}), 等待空闲标签页...`
    );
    return;
  }
  const slotsToFill =
    batchImageFetchStatus.maxConcurrent - batchImageFetchStatus.tabIds.length;
  const productsRemaining =
    batchImageFetchStatus.totalProducts - batchImageFetchStatus.currentIndex;
  const numToOpen = Math.min(slotsToFill, productsRemaining);
  if (
    numToOpen <= 0 &&
    batchImageFetchStatus.currentIndex < batchImageFetchStatus.totalProducts
  ) {
    console.log(
      '[批量抓取] 没有可打开的槽位，但仍有产品待处理。等待现有标签页关闭...'
    );
    return;
  }
  if (
    numToOpen <= 0 &&
    batchImageFetchStatus.currentIndex >= batchImageFetchStatus.totalProducts
  ) {
    console.log('[批量抓取] 没有可打开的槽位，所有产品索引已过。');
    if (batchImageFetchStatus.tabIds.length === 0) completeBatchImageFetch();
    return;
  }
  console.log(
    `[批量抓取] 准备打开 ${numToOpen} 个新标签页。当前索引: ${batchImageFetchStatus.currentIndex}, 已打开标签页: ${batchImageFetchStatus.tabIds.length}`
  );
  for (let i = 0; i < numToOpen; i++) {
    const productIndex = batchImageFetchStatus.currentIndex;
    if (productIndex < batchImageFetchStatus.totalProducts) {
      const product = batchImageFetchStatus.products[productIndex];
      batchImageFetchStatus.currentIndex++;
      if (product.itemUrl) {
        try {
          console.log(
            `[批量抓取] 尝试打开标签页处理商品: ${product.itemName || product.itemCode} (URL: ${product.itemUrl})`
          );
          const tab = await chrome.tabs.create({
            url: product.itemUrl,
            active: false,
          });
          batchImageFetchStatus.tabIds.push({
            id: tab.id,
            itemCode: product.itemCode,
            itemName: product.itemName,
            shopCode: product.shopCode || batchImageFetchStatus.shopCode,
          });
          console.log(
            `[批量抓取] 已打开标签页 ${tab.id} 访问商品: ${product.itemName || product.itemCode}`
          );
          // 🔧 修复：增加超时时间，给下载更多时间
          const timeoutId = setTimeout(async () => {
            console.warn(
              `[批量抓取] 标签页 ${tab.id} 超时 (商品: ${product.itemName || product.itemCode})。正在检查下载状态...`
            );

            // 检查是否还有下载在进行
            const tabData = batchImageFetchStatus.tabIds.find(t => t.id === tab.id);
            if (tabData && tabData.downloadInProgress) {
              console.log(`[批量抓取] 标签页 ${tab.id} 下载仍在进行，延长等待时间...`);
              // 延长等待时间
              setTimeout(async () => {
                console.warn(`[批量抓取] 标签页 ${tab.id} 最终超时，强制关闭`);
                await closeTab(tab.id, false);
              }, 30000); // 额外等待30秒
            } else {
              await closeTab(tab.id, false);
            }
          }, batchImageFetchStatus.autoCloseDelay + 15000); // 🔧 增加超时时间

          chrome.tabs.onRemoved.addListener(function listener(removedTabId) {
            if (removedTabId === tab.id) {
              clearTimeout(timeoutId);
              chrome.tabs.onRemoved.removeListener(listener);
              console.log(
                `[批量抓取] 标签页 ${tab.id} 已关闭，超时计时器已清除。`
              );
            }
          });
        } catch (error) {
          console.error(
            `[批量抓取] 打开标签页处理商品 ${product.itemName || product.itemCode} 出错:`,
            error
          );
          batchImageFetchStatus.currentIndex--;
          markProductProcessed(false);
        }
      } else {
        console.warn(
          `[批量抓取] 商品 ${product.itemName || '未知'} (索引 ${productIndex}) 没有有效的URL，跳过。`
        );
        markProductProcessed(false);
      }
    }
  }
  if (
    batchImageFetchStatus.currentIndex < batchImageFetchStatus.totalProducts &&
    batchImageFetchStatus.tabIds.length < batchImageFetchStatus.maxConcurrent
  ) {
    console.log(
      '[批量抓取] processBatchImageQueue 内部循环结束，尝试继续处理队列。'
    );
    processBatchImageQueue();
  } else if (
    batchImageFetchStatus.currentIndex >= batchImageFetchStatus.totalProducts &&
    batchImageFetchStatus.tabIds.length === 0
  ) {
    console.log(
      '[批量抓取] processBatchImageQueue 内部循环结束，所有产品已处理且无活动标签页，完成任务。'
    );
    completeBatchImageFetch();
  }
}

// 标记一个产品处理完成 (内部函数)
async function markProductProcessed(extracted = false, tabIdToClean = null) {
  if (!batchImageFetchStatus.isRunning) return;
  batchImageFetchStatus.processedCount++;
  if (extracted) batchImageFetchStatus.extractedCount++;
  console.log(
    `[批量抓取] markProductProcessed: extracted=${extracted}, processedCount=${batchImageFetchStatus.processedCount}, extractedCount=${batchImageFetchStatus.extractedCount}`
  );
  if (tabIdToClean) {
    const index = batchImageFetchStatus.tabIds.findIndex(
      t => t.id === tabIdToClean
    );
    if (index > -1) {
      batchImageFetchStatus.tabIds.splice(index, 1);
      console.log(
        `[批量抓取] 从 tabIds 中移除了 ${tabIdToClean} (markProductProcessed)`
      );
    }
  }

  // 每处理10个商品保存一次状态，避免频繁保存
  if (batchImageFetchStatus.processedCount % 10 === 0) {
    await persistBatchImageUrlData();
    await saveTaskStatus();
  }

  await sendBatchImageProgress();
  if (
    batchImageFetchStatus.processedCount >= batchImageFetchStatus.totalProducts
  ) {
    console.log(
      `[批量抓取] 所有 (${batchImageFetchStatus.processedCount}) 产品已标记为处理完成。`
    );
    if (batchImageFetchStatus.tabIds.length === 0) completeBatchImageFetch();
    else
      console.log(
        `[批量抓取] 仍有 ${batchImageFetchStatus.tabIds.length} 个活动标签页，等待它们关闭...`
      );
  } else {
    if (
      batchImageFetchStatus.tabIds.length < batchImageFetchStatus.maxConcurrent
    ) {
      console.log('[批量抓取] markProductProcessed 后，尝试继续处理队列。');
      processBatchImageQueue();
    } else {
      console.log(
        '[批量抓取] markProductProcessed 后，已达最大并发数，等待现有标签页关闭。'
      );
    }
  }
}

// 关闭标签页 (内部函数)
async function closeTab(tabId, extractedImage = false) {
  if (!batchImageFetchStatus.isRunning) {
    try {
      await chrome.tabs.remove(tabId);
      console.log(`[批量抓取] 任务已停止，但仍关闭残留标签页 ${tabId}`);
    } catch (e) {
      // 忽略错误：标签页可能已被用户关闭或不存在
      console.log(
        `[批量抓取] 关闭残留标签页 ${tabId} 时出错（已忽略）:`,
        e.message
      );
    }
    const idx = batchImageFetchStatus.tabIds.findIndex(t => t.id === tabId);
    if (idx > -1) batchImageFetchStatus.tabIds.splice(idx, 1);
    return;
  }
  const index = batchImageFetchStatus.tabIds.findIndex(t => t.id === tabId);
  if (index > -1) {
    batchImageFetchStatus.tabIds.splice(index, 1);
    console.log(`[批量抓取] 从 tabIds 列表中移除了 ${tabId}`);
  } else {
    console.log(
      `[批量抓取] closeTab: tabId ${tabId} 未在 tabIds 列表中找到，可能已被移除。`
    );
  }
  try {
    await chrome.tabs.remove(tabId);
    console.log(`[批量抓取] 已通过API关闭标签页 ${tabId}`);
  } catch (error) {
    console.log(
      `[批量抓取] 关闭标签页 ${tabId} 出错 (可能已被关闭或不存在):`,
      error.message
    );
  }
  console.log(
    `[批量抓取] 标签页 ${tabId} 关闭后，调用 markProductProcessed (${extractedImage})`
  );
  markProductProcessed(extractedImage, tabId);
}

// 完成批量图片抓取任务 (内部函数)
async function completeBatchImageFetch() {
  if (!batchImageFetchStatus.isRunning) {
    console.log(
      '[批量抓取] completeBatchImageFetch 被调用，但任务已非运行状态，忽略。'
    );
    return;
  }
  const currentShopCode = batchImageFetchStatus.shopCode; // 保存shopCode以防在重置后丢失
  console.log(
    `[批量抓取] 即将完成批量抓取任务。处理商品: ${batchImageFetchStatus.processedCount}/${batchImageFetchStatus.totalProducts}, 成功操作: ${batchImageFetchStatus.extractedCount}`
  );
  const tabsToClose = [...batchImageFetchStatus.tabIds.map(t => t.id)];
  if (tabsToClose.length > 0) {
    console.log(
      `[批量抓取] completeBatchImageFetch: 仍有 ${tabsToClose.length} 个标签页在 tabIds 中，尝试关闭它们: ${tabsToClose.join(', ')}`
    );
    for (const tabId of tabsToClose) {
      try {
        await chrome.tabs.remove(tabId);
        console.log(
          `[批量抓取] completeBatchImageFetch: 成功关闭残留标签页 ${tabId}`
        );
      } catch (error) {
        console.warn(
          `[批量抓取] completeBatchImageFetch: 关闭残留标签页 ${tabId} 出错:`,
          error.message
        );
      }
    }
  }
  await sendBatchImageProgress();
  let finalMessage, notificationTitle;
  if (batchImageFetchStatus.fetchMode === 'url_only') {
    console.log('[批量抓取] URL模式完成，准备生成CSV');
    console.log(
      '[批量抓取] imageUrlCsvData 数量:',
      batchImageFetchStatus.imageUrlCsvData.length
    );
    console.log(
      '[批量抓取] imageUrlCsvData 详细内容:',
      batchImageFetchStatus.imageUrlCsvData
    );

    const totalUrls = batchImageFetchStatus.imageUrlCsvData.reduce(
      (sum, item) => {
        const urlCount = item.urls ? item.urls.length : 0;
        console.log(`[批量抓取] 商品 ${item.itemCode} 有 ${urlCount} 个URL`);
        return sum + urlCount;
      },
      0
    );

    console.log(`[批量抓取] 总URL数量: ${totalUrls}`);

    if (batchImageFetchStatus.imageUrlCsvData.length === 0) {
      console.warn('[批量抓取] 警告: 没有收集到任何图片URL数据');
      finalMessage = `URL抓取完成，但没有收集到图片数据！\n\n📊 处理结果：\n- 已处理商品：${batchImageFetchStatus.processedCount} 个\n- 成功提取图片的商品：${batchImageFetchStatus.extractedCount} 个\n- 总图片URL数量：0 个\n\n❌ 可能原因：\n1. 商品页面没有高分辨率图片\n2. 图片提取逻辑有问题\n3. 网络连接问题`;
      notificationTitle = '图片URL抓取完成（无数据）';
    } else {
      await generateAndDownloadImageUrlCsv(
        batchImageFetchStatus.imageUrlCsvData,
        currentShopCode
      );
      finalMessage = `URL抓取完成！\n\n📊 处理结果：\n- 已处理商品：${batchImageFetchStatus.processedCount} 个\n- 成功提取图片的商品：${batchImageFetchStatus.extractedCount} 个\n- 总图片URL数量：${totalUrls} 个\n\n📁 CSV文件已开始下载，包含所有图片URL信息。`;
      notificationTitle = '图片URL抓取完成';
    }
  } else if (batchImageFetchStatus.fetchMode === 'download_files') {
    // 🔧 修复：使用内部统计数据而不是查询下载API
    const totalDownloadAttempts = batchImageFetchStatus.downloadSuccessCount + batchImageFetchStatus.downloadFailureCount;
    const downloadInfo = await _getDownloadLocationInfo();

    // 🔧 修复：自动打开下载管理页面
    try {
      await chrome.tabs.create({ url: 'chrome://downloads/', active: false });
      console.log('已自动打开下载管理页面');
    } catch (error) {
      console.warn('无法自动打开下载管理页面:', error);
    }

    finalMessage = `🎉 图片文件下载任务完成！\n\n📊 处理结果：\n- 已处理商品：${batchImageFetchStatus.processedCount} 个\n- 成功下载图片的商品：${batchImageFetchStatus.extractedCount} 个\n- 成功下载文件数：${batchImageFetchStatus.downloadSuccessCount} 个\n- 下载失败文件数：${batchImageFetchStatus.downloadFailureCount} 个\n\n📁 图片保存位置：\n${downloadInfo.path}\n\n📋 文件夹结构：\n${currentShopCode}/\n  ├── 商品代码1/\n  │   ├── 图片1.jpg\n  │   └── 图片2.jpg\n  └── 商品代码2/\n      ├── 图片1.jpg\n      └── 图片2.jpg\n\n✅ 下载管理页面已自动打开！\n💡 您也可以：\n• 按 Ctrl+J (Windows) 或 Cmd+Shift+J (Mac)\n• 在浏览器地址栏输入 chrome://downloads/\n• 点击任一下载文件的"在文件夹中显示"`;
    notificationTitle = `批量图片下载完成 (${batchImageFetchStatus.downloadSuccessCount}/${totalDownloadAttempts})`;
  } else {
    // storage_save 模式
    finalMessage = `图片信息记录完成！\n\n📊 处理结果：\n- 已处理商品：${batchImageFetchStatus.processedCount} 个\n- 成功记录图片的商品：${batchImageFetchStatus.extractedCount} 个\n\n💾 图片信息已保存到浏览器存储中，可在主CSV导出时合并显示。`;
    notificationTitle = '图片信息记录完成';
  }
  console.log(`[批量抓取] ${finalMessage}`);
  showNotification(notificationTitle, finalMessage);
  console.log('[批量抓取] 重置 batchImageFetchStatus');

  if (batchImageFetchStatus.imageUrlCsvData.length > 0) {
    await persistBatchImageUrlData(currentShopCode);
  }

  // 停止内存监控
  memoryManager.stopMonitoring();

  Object.assign(batchImageFetchStatus, {
    isRunning: false,
    shopCode: null,
    products: [],
    totalProducts: 0,
    currentIndex: 0,
    processedCount: 0,
    extractedCount: 0,
    downloadSuccessCount: 0, // 🔧 修复：重置下载成功计数
    downloadFailureCount: 0, // 🔧 修复：重置下载失败计数
    tabIds: [],
    fetchMode: 'download_files',
    imageUrlCsvData: [],
  });

  // 保存状态
  await saveTaskStatus();
}

// 取消批量图片抓取任务
export async function cancelBatchImageFetch() {
  if (!batchImageFetchStatus.isRunning) return;
  console.log('[批量抓取] 取消批量抓取任务');
  sendProgressToPopup('批量图片抓取任务已取消。');
  const currentShopCode = batchImageFetchStatus.shopCode;
  const currentFetchMode = batchImageFetchStatus.fetchMode; // 保存当前模式
  const partialImageUrlData = [...batchImageFetchStatus.imageUrlCsvData];
  for (const tabEntry of batchImageFetchStatus.tabIds) {
    try {
      await chrome.tabs.remove(tabEntry.id);
    } catch (e) {
      // 忽略错误：标签页可能已被用户关闭或不存在
      console.log(
        `[批量抓取] 取消任务时关闭标签页 ${tabEntry.id} 失败（已忽略）:`,
        e.message
      );
    }
  }
  // 重置时保留shopCode和products以备可能的恢复或分析，但清除活动状态和URL数据
  Object.assign(batchImageFetchStatus, {
    isRunning: false,
    tabIds: [],
    // fetchMode: 'download_files', // 或者保持之前的模式
    imageUrlCsvData: [],
  });

  if (currentShopCode && partialImageUrlData.length > 0) {
    await saveBatchImageUrlData(currentShopCode, partialImageUrlData);
  }

  // 保存状态
  await saveTaskStatus();

  showNotification(
    '批量图片抓取已取消',
    `操作已中止 (模式: ${currentFetchMode})`
  );
}

// 生成并下载图片URL的CSV文件 (内部函数) - 优化版本
async function generateAndDownloadImageUrlCsv(data, shopCode) {
  console.log('[CSV Export] 开始生成图片URL CSV文件（优化版本）');
  console.log('[CSV Export] 数据检查:', data);

  if (!data || data.length === 0) {
    console.log('[CSV Export] 没有图片URL数据可供导出');
    showNotification(
      'CSV导出提示',
      '没有图片URL数据可供导出。请确保已成功抓取到图片。',
      'basic'
    );
    return;
  }

  try {
    // 在Service Worker中直接生成CSV，不使用动态import
    console.log(`[CSV Export] 开始生成CSV数据，共 ${data.length} 个商品`);

    let csvContent = 'ShopCode,ItemCode,ItemName,ImageURL,ImageIndex\n';
    let totalUrls = 0;

    for (const item of data) {
      const { shopCode, itemCode, itemName, urls } = item;
      const safeItemName = (itemName || '').replace(/"/g, '""'); // 转义CSV中的引号

      urls.forEach((url, index) => {
        csvContent += `"${shopCode}","${itemCode}","${safeItemName}","${url}",${index + 1}\n`;
        totalUrls++;
      });
    }

    const result = {
      csvContent: csvContent,
      totalUrls: totalUrls,
      size: new Blob([csvContent]).size,
    };

    console.log(
      `[CSV Export] CSV生成完成，共 ${result.totalUrls} 行数据，大小: ${(result.size / 1024).toFixed(2)}KB`
    );

    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[-:]/g, '')
      .replace('T', '_');
    const filename = `rakuten_image_urls_${shopCode}_${timestamp}.csv`;

    console.log(`[CSV Export] 开始下载文件: ${filename}`);
    console.log(`[CSV Export] CSV内容大小: ${result.size} 字节`);

    // 检查Chrome downloads API是否可用
    if (!chrome.downloads) {
      console.error('[CSV Export] Chrome downloads API 不可用');
      throw new Error('Chrome downloads API 不可用');
    }

    // 在Service Worker环境中，直接使用data URL
    const dataUrl =
      'data:text/csv;charset=utf-8,' +
      encodeURIComponent('\uFEFF' + result.csvContent);

    console.log(`[CSV Export] 使用data URL下载，长度: ${dataUrl.length}`);

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: filename,
        saveAs: false, // 直接下载
      },
      downloadId => {
        console.log(`[CSV Export] 下载回调执行，downloadId: ${downloadId}`);
        console.log(
          `[CSV Export] chrome.runtime.lastError:`,
          chrome.runtime.lastError
        );

        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || '未知下载错误';
          console.error('[CSV Export] 下载错误:', errorMsg);
          showNotification('CSV导出失败', `下载错误: ${errorMsg}`, 'basic');
        } else {
          if (downloadId) {
            console.log('[CSV Export] CSV下载开始，ID:', downloadId);
            showNotification(
              'CSV导出成功',
              `文件 ${filename} 已开始下载。包含 ${data.length} 个商品的 ${result.totalUrls} 个图片URL。`,
              'basic'
            );
          } else {
            console.log('[CSV Export] 下载未开始或被取消');
            showNotification(
              'CSV导出提示',
              'CSV文件下载未开始或被取消。',
              'basic'
            );
          }
        }
      }
    );
  } catch (error) {
    console.error('[CSV Export] 生成或下载CSV时出错:', error);
    console.error('[CSV Export] 错误详情:', error.message);
    console.error('[CSV Export] 错误堆栈:', error.stack);
    showNotification(
      'CSV导出错误',
      `无法生成或下载CSV文件: ${error.message}`,
      'basic'
    );
  }
}

// 🔧 新增：获取实际下载统计信息
async function _getActualDownloadStats(shopCode) {
  try {
    // 查找最近5分钟内与该店铺相关的下载
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    const downloads = await chrome.downloads.search({
      startTime: new Date(fiveMinutesAgo).toISOString(),
      filenameRegex: `.*${shopCode}.*`
    });

    let successCount = 0;
    let failedCount = 0;

    downloads.forEach(download => {
      if (download.state === 'complete') {
        successCount++;
      } else if (download.state === 'interrupted' || download.error) {
        failedCount++;
      }
    });

    console.log(`下载统计 - 成功: ${successCount}, 失败: ${failedCount}`);
    return { successCount, failedCount, totalAttempts: downloads.length };
  } catch (error) {
    console.warn('无法获取下载统计:', error);
    return { successCount: 0, failedCount: 0, totalAttempts: 0 };
  }
}

// 获取下载位置信息的辅助函数
async function _getDownloadLocationInfo() {
  try {
    // 尝试获取默认下载目录
    const downloads = await chrome.downloads.search({ limit: 1 });
    if (downloads.length > 0) {
      const filepath = downloads[0].filename;
      // 从文件路径推断下载目录
      const pathParts = filepath.split(/[/\\]/);
      pathParts.pop(); // 移除文件名
      const downloadDir = pathParts.join('/') || '下载文件夹';

      return {
        path: `${downloadDir}/  (您的默认下载目录)`,
        accessible: true
      };
    }
  } catch (error) {
    console.log('无法获取下载目录信息:', error);
  }

  // fallback 信息
  return {
    path: `您的浏览器默认下载目录 (通常是 Downloads 文件夹)`,
    accessible: false
  };
}

// 图片处理器类
class ImageProcessor {
  constructor(batchStatus) {
    this.batchStatus = batchStatus;
  }

  async processUrlOnlyMode(images, shopCode, itemCode, itemName) {
    console.log(
      `[URL_ONLY_MODE] 开始处理商品 ${shopCode}:${itemCode} 的图片数据`
    );
    console.log(`[URL_ONLY_MODE] 收到的图片数据:`, images);
    console.log(
      `[URL_ONLY_MODE] 图片数据类型:`,
      typeof images,
      '数量:',
      images ? images.length : 0
    );

    if (!images || images.length === 0) {
      console.warn(`[URL_ONLY_MODE] 商品 ${itemCode} 没有图片数据`);
      return { success: true, mode: 'url_only', count: 0 };
    }

    // 修复：确保提取正确的URL字符串
    const imageUrls = images
      .map((imageData, index) => {
        console.log(`[URL_ONLY_MODE] 处理第 ${index + 1} 张图片:`, imageData);
        if (typeof imageData === 'string') {
          console.log(
            `[URL_ONLY_MODE] 图片 ${index + 1} 是字符串URL:`,
            imageData
          );
          return imageData;
        } else if (
          imageData &&
          typeof imageData === 'object' &&
          imageData.url
        ) {
          console.log(
            `[URL_ONLY_MODE] 图片 ${index + 1} 是对象，URL:`,
            imageData.url
          );
          return imageData.url;
        } else {
          console.error(
            `[URL_ONLY_MODE] 图片 ${index + 1} 无效的数据格式:`,
            imageData
          );
          return null;
        }
      })
      .filter(
        url => url !== null && typeof url === 'string' && url.trim().length > 0
      );

    console.log(
      `[URL_ONLY_MODE] 成功提取 ${imageUrls.length} 个有效URL:`,
      imageUrls
    );

    const existingEntry = this.batchStatus.imageUrlCsvData.find(
      entry => entry.itemCode === itemCode && entry.shopCode === shopCode
    );

    if (existingEntry) {
      imageUrls.forEach(imageUrl => {
        if (!existingEntry.urls.includes(imageUrl)) {
          existingEntry.urls.push(imageUrl);
        }
      });
    } else {
      this.batchStatus.imageUrlCsvData.push({
        shopCode: shopCode,
        itemCode: itemCode,
        itemName: itemName,
        urls: [...new Set(imageUrls)],
      });
    }

    console.log(
      `[URL_ONLY_MODE] 为 ${shopCode}:${itemCode} (${itemName}) 添加/更新了 ${imageUrls.length} 个URL。CSV数据条目数: ${this.batchStatus.imageUrlCsvData.length}`
    );
    return { success: true, mode: 'url_only', count: imageUrls.length };
  }

  async processDownloadFilesMode(images, shopCode, itemCode, itemName) {
    console.log(
      `[DOWNLOAD_FILES_MODE] 开始为 ${shopCode}:${itemCode} 下载 ${images.length} 张图片。`
    );
    console.log(
      `[DOWNLOAD_FILES_MODE] 图片数据类型检查:`,
      images.map(img => typeof img)
    );
    console.log(`[DOWNLOAD_FILES_MODE] 图片数据示例:`, images[0]);

    // 🔧 修复：标记下载开始
    const currentTab = batchImageFetchStatus.tabIds.find(t => t.shopCode === shopCode);
    if (currentTab) {
      currentTab.downloadInProgress = true;
    }

    // 🔧 修复：在下载模式下也保存URL数据，用于后续导出
    const imageUrls = images
      .map(imageData => {
        if (typeof imageData === 'string') {
          return imageData;
        } else if (imageData && typeof imageData === 'object' && imageData.url) {
          return imageData.url;
        }
        return null;
      })
      .filter(url => url !== null && typeof url === 'string' && url.trim().length > 0);

    // 保存URL数据到imageUrlCsvData
    const existingEntry = this.batchStatus.imageUrlCsvData.find(
      entry => entry.itemCode === itemCode && entry.shopCode === shopCode
    );

    if (existingEntry) {
      imageUrls.forEach(imageUrl => {
        if (!existingEntry.urls.includes(imageUrl)) {
          existingEntry.urls.push(imageUrl);
        }
      });
    } else {
      this.batchStatus.imageUrlCsvData.push({
        shopCode: shopCode,
        itemCode: itemCode,
        itemName: itemName || `商品${itemCode}`,
        urls: [...new Set(imageUrls)],
      });
    }

    console.log(`[DOWNLOAD_FILES_MODE] 已保存 ${imageUrls.length} 个URL到CSV数据中`);


    let downloadSuccessCount = 0;
    let downloadFailureCount = 0;
    const downloadPaths = [];
    const downloadErrors = [];

    for (const imageData of images) {
      try {
        // 修复：确保获取正确的URL字符串
        let imageUrl;
        if (typeof imageData === 'string') {
          imageUrl = imageData;
        } else if (
          imageData &&
          typeof imageData === 'object' &&
          imageData.url
        ) {
          imageUrl = imageData.url;
        } else {
          console.error(`[DOWNLOAD_FILES_MODE] 无效的图片数据格式:`, imageData);
          downloadFailureCount++;
          downloadErrors.push(`无效的图片数据格式: ${JSON.stringify(imageData)}`);
          continue;
        }

        console.log(`[DOWNLOAD_FILES_MODE] 准备下载图片URL: ${imageUrl}`);
        const result = await this._downloadSingleImage(
          imageUrl,
          shopCode,
          itemCode
        );
        
        if (result.success) {
          downloadSuccessCount++;
          // 🔧 修复：更新全局下载成功计数
          this.batchStatus.downloadSuccessCount++;
          downloadPaths.push(result.filename);
          console.log(`[DOWNLOAD_FILES_MODE] 下载成功: ${result.filename}`);
        } else {
          downloadFailureCount++;
          // 🔧 修复：更新全局下载失败计数
          this.batchStatus.downloadFailureCount++;
          const errorMsg = `下载失败: ${result.filename || imageUrl} - ${result.error}`;
          downloadErrors.push(errorMsg);
          console.error(`[DOWNLOAD_FILES_MODE] ${errorMsg}`);
        }
      } catch (error) {
        downloadFailureCount++;
        // 🔧 修复：更新全局下载失败计数
        this.batchStatus.downloadFailureCount++;
        const errorMsg = `下载图片时出错: ${error.message}`;
        downloadErrors.push(errorMsg);
        console.error(`[DOWNLOAD_FILES_MODE] 准备下载图片时出错:`, error);
        console.error(`[DOWNLOAD_FILES_MODE] 问题图片数据:`, imageData);
      }
    }

    // 记录下载结果统计
    console.log(
      `[DOWNLOAD_FILES_MODE] 下载统计 - 成功: ${downloadSuccessCount}, 失败: ${downloadFailureCount}, 总计: ${images.length}`
    );

    // 记录下载路径信息
    if (downloadPaths.length > 0) {
      console.log(
        `[DOWNLOAD_FILES_MODE] ${downloadSuccessCount} 个图片已成功下载到浏览器默认下载目录:`
      );
      downloadPaths.forEach(path => console.log(`  - ${path}`));
    }

    // 记录错误信息
    if (downloadErrors.length > 0) {
      console.warn(
        `[DOWNLOAD_FILES_MODE] ${downloadFailureCount} 个图片下载失败:`
      );
      downloadErrors.forEach(error => console.warn(`  - ${error}`));
    }

    // 🔧 修复：标记下载完成
    if (currentTab) {
      currentTab.downloadInProgress = false;
      console.log(`[DOWNLOAD_FILES_MODE] 商品 ${itemCode} 下载完成，清除下载状态标记`);
    }

    return {
      success: true,
      mode: 'download_files',
      totalAttempted: images.length,
      successCount: downloadSuccessCount,
      failureCount: downloadFailureCount,
      downloadPaths: downloadPaths,
      downloadErrors: downloadErrors,
      // 添加实时下载状态信息
      downloadSummary: {
        totalImages: images.length,
        successfulDownloads: downloadSuccessCount,
        failedDownloads: downloadFailureCount,
        successRate: images.length > 0 ? Math.round((downloadSuccessCount / images.length) * 100) : 0,
        downloadDirectory: downloadPaths.length > 0 ? downloadPaths[0].split('/').slice(0, -1).join('/') : '未知位置'
      }
    };
  }

  async processStorageMode(images, shopCode, itemCode) {
    try {
      // 添加调试信息
      console.log(
        `[STORAGE_MODE] 准备保存图片信息: 店铺=${shopCode}, 商品=${itemCode}, 图片数量=${images.length}`
      );
      console.log(`[STORAGE_MODE] 使用的存储键值: ${itemCode}`);

      await BatchErrorHandler.wrapAsync(
        () => saveHighResImages(shopCode, itemCode, images),
        'SAVE_IMAGES_ERROR',
        '保存图片信息到存储'
      );

      console.log(
        `[STORAGE_MODE] 已将 ${images.length} 张图片信息保存到存储 (店铺=${shopCode}, 商品=${itemCode})`
      );
      return { success: true, mode: 'storage_save' };
    } catch (error) {
      console.error('[STORAGE_MODE] 保存图片信息到存储时出错:', error);
      throw error;
    }
  }

  async _downloadSingleImage(imageUrl, shopCode, itemCode) {
    return new Promise((resolve) => {
      const originalFilename = getOriginalFilenameFromUrl(imageUrl);
      const safeShopCode = sanitizePathComponent(shopCode);
      const safeItemCode = sanitizePathComponent(itemCode);
      const filename = `${safeShopCode}/${safeItemCode}/${sanitizePathComponent(originalFilename)}`;
      const downloadTimeout = 30000; // 30秒超时

      let timeoutId;
      let downloadStateListener;
      let isResolved = false;

      const safeResolve = (result) => {
        if (isResolved) return;
        isResolved = true;
        
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (downloadStateListener) {
          chrome.downloads.onChanged.removeListener(downloadStateListener);
        }
        resolve(result);
      };

      chrome.downloads.download(
        {
          url: imageUrl,
          filename: filename,
          saveAs: false,
        },
        downloadId => {
          if (chrome.runtime.lastError) {
            console.error(
              `[DOWNLOAD_FILES_MODE] 下载 ${filename} (URL: ${imageUrl}) 失败:`,
              chrome.runtime.lastError.message
            );
            safeResolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }

          if (downloadId === undefined) {
            console.warn(
              `[DOWNLOAD_FILES_MODE] 下载 ${filename} (URL: ${imageUrl}) 未启动 (downloadId is undefined). 可能被浏览器阻止或发生其他问题。`
            );
            safeResolve({ success: false, error: 'Download not started' });
            return;
          }

          console.log(
            `[DOWNLOAD_FILES_MODE] 开始下载 ${filename} (URL: ${imageUrl}), ID: ${downloadId}`
          );

          // 设置超时
          timeoutId = setTimeout(() => {
            console.warn(
              `[DOWNLOAD_FILES_MODE] 下载 ${filename} 超时 (${downloadTimeout}ms)`
            );
            safeResolve({ 
              success: false, 
              error: `Download timeout after ${downloadTimeout / 1000}s`,
              downloadId,
              filename 
            });
          }, downloadTimeout);

          // 监听下载状态变化
          downloadStateListener = (downloadDelta) => {
            if (downloadDelta.id === downloadId) {
              if (downloadDelta.state) {
                if (downloadDelta.state.current === 'complete') {
                  console.log(
                    `[DOWNLOAD_FILES_MODE] 下载成功完成: ${filename}`
                  );
                  safeResolve({ 
                    success: true, 
                    downloadId, 
                    filename,
                    state: 'complete'
                  });
                } else if (downloadDelta.state.current === 'interrupted') {
                  console.error(
                    `[DOWNLOAD_FILES_MODE] 下载中断: ${filename}, 原因: ${downloadDelta.error?.current || 'unknown'}`
                  );
                  safeResolve({
                    success: false,
                    error: `Download interrupted: ${downloadDelta.error?.current || 'unknown'}`,
                    downloadId,
                    filename
                  });
                }
              }

              if (downloadDelta.error) {
                console.error(
                  `[DOWNLOAD_FILES_MODE] 下载错误: ${filename}, 错误: ${downloadDelta.error.current}`
                );
                safeResolve({
                  success: false,
                  error: `Download error: ${downloadDelta.error.current}`,
                  downloadId,
                  filename
                });
              }
            }
          };

          chrome.downloads.onChanged.addListener(downloadStateListener);
        }
      );
    });
  }
}

// 处理来自内容脚本的检测到的高分辨率图片消息
export async function handleDetectedHighResImages(
  message,
  sender,
  sendResponse
) {
  try {
    const validationResult = _validateImageMessage(message, sender);
    if (!validationResult.valid) {
      _safeResponse(sendResponse, {
        success: false,
        error: validationResult.error,
      });
      return;
    }

    const { tabId, tabData } = validationResult;
    const {
      shopCode: currentShopCode,
      itemCode: currentItemCode,
      itemName: currentItemName,
    } = tabData;

    // 验证任务状态
    if (
      !batchImageFetchStatus.isRunning ||
      batchImageFetchStatus.shopCode !== currentShopCode
    ) {
      console.warn(
        `[BF] 收到来自店铺 ${currentShopCode} 的图片，但当前任务是为店铺 ${batchImageFetchStatus.shopCode} 或任务已停止。忽略。`
      );
      closeTab(tabId, false);
      _safeResponse(sendResponse, {
        success: false,
        error: '店铺代码不匹配当前任务或任务已停止',
      });
      return;
    }

    if (message.images && message.images.length > 0) {
      const processor = new ImageProcessor(batchImageFetchStatus);
      const result = await _processImagesByMode(
        processor,
        message.images,
        currentShopCode,
        currentItemCode,
        currentItemName
      );

      closeTab(tabId, result.success);
      _safeResponse(sendResponse, result);
    } else {
      console.log(
        `[BF] 未从 ${message.productUrl} (TabID: ${tabId}) 提取到有效图片数据。`
      );
      closeTab(tabId, false);
      _safeResponse(sendResponse, {
        success: false,
        error: '未提取到图片数据',
      });
    }
  } catch (error) {
    console.error('[BF] 处理高分辨率图片时出错:', error);
    _safeResponse(sendResponse, {
      success: false,
      error: error.message || '处理图片时发生错误',
    });
  }
}

// 验证图片消息
function _validateImageMessage(message, sender) {
  console.log(
    `[BF] 收到高分辨率图片数据: ${message.images ? message.images.length : 0}张图片 从URL: ${message.productUrl} (TabID: ${sender.tab ? sender.tab.id : 'N/A'})`
  );

  const tabId = sender.tab ? sender.tab.id : null;
  if (!tabId) {
    console.warn('[BF] detectedHighResImages: 未能从sender获取tabId。');
    return { valid: false, error: '无法确定来源标签页' };
  }

  const tabData = batchImageFetchStatus.tabIds.find(t => t.id === tabId);
  if (!tabData) {
    console.log(`[BF] 收到来自已处理标签页 ${tabId} 的消息，忽略（正常情况）`);
    return { valid: false, error: '标签页已处理完成' };
  }

  return { valid: true, tabId, tabData };
}

// 根据模式处理图片
async function _processImagesByMode(
  processor,
  images,
  shopCode,
  itemCode,
  itemName
) {
  const mode = batchImageFetchStatus.fetchMode;

  try {
    switch (mode) {
      case 'url_only':
        return await processor.processUrlOnlyMode(
          images,
          shopCode,
          itemCode,
          itemName
        );
      case 'download_files':
        return await processor.processDownloadFilesMode(
          images,
          shopCode,
          itemCode,
          itemName
        );
      default: // storage_save or fallback
        return await processor.processStorageMode(images, shopCode, itemCode);
    }
  } catch (error) {
    console.error(`[BF] 处理图片模式 ${mode} 时出错:`, error);
    return { success: false, error: error.message, mode };
  }
}

// 安全响应函数
function _safeResponse(sendResponse, response) {
  try {
    sendResponse(response);
  } catch (e) {
    console.warn('BF: sendResponse failed', e);
  }
}

// 🔧 新增：获取批量图片URL数据的函数
export async function getBatchImageUrlData(shopCode) {
  console.log(`[BF] 获取店铺 ${shopCode} 的批量图片URL数据`);

  if (
    Array.isArray(batchImageFetchStatus.imageUrlCsvData) &&
    batchImageFetchStatus.imageUrlCsvData.length > 0
  ) {
    const shopImageData = batchImageFetchStatus.imageUrlCsvData.filter(
      entry => entry.shopCode === shopCode
    );

    if (shopImageData.length > 0) {
      console.log(`[BF] 从内存中找到店铺 ${shopCode} 的批量图片URL数据，共 ${shopImageData.length} 个商品`);
      return shopImageData;
    }
  }

  const storedImageData = await loadBatchImageUrlData(shopCode);
  if (!storedImageData || storedImageData.length === 0) {
    console.log(`[BF] 没有找到店铺 ${shopCode} 的批量图片URL数据`);
    return null;
  }

  console.log(`[BF] 从存储中找到店铺 ${shopCode} 的批量图片URL数据，共 ${storedImageData.length} 个商品`);
  return storedImageData;
}
