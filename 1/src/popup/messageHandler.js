/**
 * 消息通信处理模块
 * 负责与Service Worker的通信，包括重试机制和Service Worker唤醒
 */

// 通用的消息发送工具函数（带重试机制和Service Worker唤醒）
export async function sendMessageToServiceWorker(
  message,
  timeout = 30000,
  maxRetries = 3
) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 在每次尝试前，先尝试唤醒Service Worker
      if (attempt > 0) {
        console.log(`尝试 ${attempt + 1}: 先唤醒Service Worker...`);
        await _wakeUpServiceWorker();
      }

      const result = await _sendSingleMessage(message, timeout);
      return result;
    } catch (error) {
      lastError = error;
      console.log(
        `消息发送尝试 ${attempt + 1}/${maxRetries + 1} 失败:`,
        error.message
      );

      // 如果是端口关闭错误，增加等待时间让Service Worker重新启动
      if (error.message && error.message.includes('message port closed')) {
        if (attempt < maxRetries) {
          const waitTime = (attempt + 1) * 1500; // 递增等待时间
          console.log(`端口关闭，等待 ${waitTime}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      } else if (attempt < maxRetries) {
        console.log('等待1秒后重试...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // 所有重试都失败了
  throw lastError;
}

// 尝试唤醒Service Worker
async function _wakeUpServiceWorker() {
  return new Promise(resolve => {
    // 发送一个简单的ping消息来唤醒Service Worker
    chrome.runtime.sendMessage({ action: 'ping' }, () => {
      // 不管成功失败都继续，这只是为了唤醒Service Worker
      if (chrome.runtime.lastError) {
        console.log(
          '唤醒Service Worker时出现错误（这是正常的）:',
          chrome.runtime.lastError.message
        );
      }
      resolve();
    });
  });
}

// 单次消息发送函数
function _sendSingleMessage(message, timeout) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log(`[${startTime}] 发送消息到Service Worker:`, message);
    console.log(`[${startTime}] 超时设置: ${timeout}ms`);

    let responseReceived = false;

    const timeoutId = setTimeout(async () => {
      if (!responseReceived) {
        responseReceived = true; // 防止竞态条件
        const elapsed = Date.now() - startTime;
        console.error(`[${Date.now()}] 消息发送超时! 已等待: ${elapsed}ms`);

        // 处理超时后的状态恢复
        await handleCommunicationTimeout(message);

        reject(new Error(`消息发送超时 (${elapsed}ms)`));
      }
    }, timeout);

    try {
      chrome.runtime.sendMessage(message, response => {
        if (responseReceived) return; // 防止重复处理
        responseReceived = true;

        const elapsed = Date.now() - startTime;
        clearTimeout(timeoutId);
        console.log(`[${Date.now()}] 消息响应耗时: ${elapsed}ms`);

        // 检查Chrome runtime错误
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.error(`[${Date.now()}] Chrome runtime错误:`, lastError);
          console.error(`[${Date.now()}] 错误消息:`, lastError.message);

          // 特殊处理消息端口关闭错误
          if (
            lastError.message &&
            lastError.message.includes('message port closed')
          ) {
            console.warn(
              `[${Date.now()}] 消息端口已关闭，但Service Worker可能已处理请求`
            );

            // 对于数据查询操作，尝试延迟重试
            const actionType = _getActionType(message.action);
            console.log(`[${Date.now()}] 操作类型: ${actionType}`);

            if (actionType === 'data_query') {
              console.log(
                `[${Date.now()}] 数据查询操作，端口关闭但可能已有响应，延迟200ms重试`
              );
              setTimeout(() => {
                // 简单重试一次，不使用递归避免无限循环
                chrome.runtime.sendMessage(message, retryResponse => {
                  if (chrome.runtime.lastError) {
                    console.error(`[${Date.now()}] 重试仍失败，返回错误`);
                    reject(
                      new Error(
                        '消息端口已关闭，无法获取数据。请重新打开插件窗口。'
                      )
                    );
                  } else {
                    console.log(
                      `[${Date.now()}] 重试成功，收到响应:`,
                      retryResponse
                    );
                    resolve(retryResponse);
                  }
                });
              }, 200);
              return;
            } else {
              // 后台任务或数据修改操作
              console.log(
                `[${Date.now()}] ${actionType}操作，假设已在后台完成`
              );
              resolve({
                success: true,
                backgroundTask: true,
                message: '操作可能已在后台完成',
              });
              return;
            }
          } else {
            console.error(`[${Date.now()}] 其他Chrome runtime错误`);
            reject(new Error(lastError.message || '未知的Chrome runtime错误'));
            return;
          }
        }

        // 正常响应处理
        console.log(`[${Date.now()}] 收到Service Worker响应:`, response);
        console.log(`[${Date.now()}] 响应类型:`, typeof response);
        console.log(`[${Date.now()}] 响应成功状态:`, response?.success);

        if (response === undefined) {
          console.warn(
            `[${Date.now()}] 响应为undefined，可能Service Worker未正确响应`
          );
          reject(new Error('Service Worker响应为空'));
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      responseReceived = true;
      clearTimeout(timeoutId);
      console.error(`[${Date.now()}] 发送消息时发生异常:`, error);
      reject(error);
    }
  });
}

// 根据操作类型分类
function _getActionType(action) {
  // 长时间后台任务
  const backgroundTasks = ['scrapeShop', 'batchFetchHighResImages', 'batchFetchImages'];
  if (backgroundTasks.includes(action)) {
    return 'background_task';
  }

  // 数据修改操作（可能在后台完成）
  const dataModifications = ['clearShopData', 'cancelBatchImageFetch', 'stopScraping', 'forceStopAllTasks'];
  if (dataModifications.includes(action)) {
    return 'data_modification';
  }

  // 快速响应操作（立即返回）
  const quickOperations = ['ping', 'getCurrentStatus', 'quickTest'];
  if (quickOperations.includes(action)) {
    return 'quick_operation';
  }

  // 数据查询操作（需要立即返回结果）
  const dataQueries = [
    'getShopData',
    'getShopHighResImages',
    'getHighResImages',
    'getProductsByShop', // 🔧 修复：添加缺失的操作
  ];
  if (dataQueries.includes(action)) {
    return 'data_query';
  }

  // 默认为数据查询
  return 'data_query';
}

// 防止重复注册监听器的标志
let messageListenerRegistered = false;

// 存储监听器引用以便清理
let currentMessageListener = null;

// 消息监听器设置
export function setupMessageListeners(logProgress) {
  if (messageListenerRegistered) {
    console.log('[MessageHandler] 消息监听器已注册，跳过重复注册');
    return;
  }

  console.log('[MessageHandler] 正在注册消息监听器...');

  // 清理旧的监听器
  if (currentMessageListener) {
    chrome.runtime.onMessage.removeListener(currentMessageListener);
  }

  // 创建新的监听器
  currentMessageListener = (request) => {
    console.log('[MessageHandler] 收到消息:', request.action);

    if (request.action === 'logToPopup') {
      logProgress(request.message, request.logType || 'info');
      return false; // 表示不会异步发送响应
    }

    // 添加对批量图片抓取进度的监听
    if (request.action === 'batchImageProgress') {
      handleBatchImageProgress(request);
      return false;
    }

    // 添加对店铺抓取进度的监听
    if (request.action === 'updateScrapeProgress') {
      handleScrapeProgress(request);
      return false;
    }

    return false;
  };

  // 注册监听器
  chrome.runtime.onMessage.addListener(currentMessageListener);

  messageListenerRegistered = true;
  console.log('[MessageHandler] 消息监听器注册完成');
}

// 清理消息监听器
export function cleanupMessageListeners() {
  if (currentMessageListener) {
    chrome.runtime.onMessage.removeListener(currentMessageListener);
    currentMessageListener = null;
    messageListenerRegistered = false;
    console.log('[MessageHandler] 消息监听器已清理');
  }
}

// 处理店铺抓取进度
function handleScrapeProgress(request) {
  console.log('收到店铺抓取进度更新:', request);

  // 如果任务完成，更新UI状态
  if (request.completed && request.progress === 100) {
    console.log('检测到任务完成，准备更新UI状态');

    // 延迟一点时间，然后恢复UI状态
    setTimeout(() => {
      // 恢复按钮状态
      if (window.buttonManager) {
        window.buttonManager.showStartButton();
        window.buttonManager.enableAll();
      }

      // 隐藏加载指示器
      const statusArea = document.getElementById('statusArea');
      if (statusArea) {
        statusArea.textContent = '抓取完成！';
        statusArea.className = 'message-base message-success';
      }

      // 释放操作锁（如果存在）
      if (window.operationLock && window.operationLock.release) {
        window.operationLock.release();
        console.log('任务完成，已释放操作锁');
      }
    }, 1500);
  }
}

// 处理批量图片抓取进度
function handleBatchImageProgress(request) {
  console.log('收到批量图片进度更新:', request);

  // 确保在进度更新时显示正确的按钮状态
  const fetchImagesBtn = document.getElementById('fetchImagesBtn');
  const stopImageFetchBtn = document.getElementById('stopImageFetchBtn');

  if (request.current < request.total) {
    // 任务进行中，显示停止按钮
    if (fetchImagesBtn) fetchImagesBtn.style.display = 'none';
    if (stopImageFetchBtn) stopImageFetchBtn.style.display = 'block';
  }

  // 更新进度条
  const percent = (request.current / request.total) * 100;
  const progressFill = document.getElementById('imageProgressFill');
  const progressText = document.getElementById('imageProgressText');
  if (progressFill && progressText) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${Math.round(percent)}%`;
  }

  // 更新进度文本
  const progressElement = document.getElementById('currentBatchProgress');
  if (progressElement) {
    progressElement.textContent = `${request.current}/${request.total}`;
  }

  // 更新图片状态区域
  const imageStatusText = document.getElementById('imageStatusText');
  if (imageStatusText) {
    if (request.current >= request.total) {
      imageStatusText.innerHTML = `<span style="color:#27ae60;">✅ 批量抓取完成: 已处理 ${request.current} 个商品，成功提取 ${request.extractedCount} 个商品的图片</span>`;
    } else {
      imageStatusText.innerHTML = `<span style="color:#3498db;">🔄 正在批量抓取: ${request.current}/${request.total} (已提取 ${request.extractedCount} 个)</span>`;
    }
  }

  // 如果完成了，显示最终结果并恢复按钮状态
  if (request.current >= request.total) {
    // 🔧 修复：自动打开下载管理页面
    if (request.fetchMode === 'download_files' && request.extractedCount > 0) {
      try {
        chrome.tabs.create({ url: 'chrome://downloads/', active: false });
        console.log('图片下载完成，已自动打开下载管理页面');
      } catch (error) {
        console.warn('无法自动打开下载管理页面:', error);
      }
    }

    const statusArea = document.getElementById('statusArea');
    if (statusArea) {
      let statusMessage = `🎉 完成! 已处理 ${request.current} 个产品，成功提取 ${request.extractedCount} 个产品的高分辨率图片。`;

      // 🔧 修复：根据模式显示不同的完成消息
      if (request.fetchMode === 'download_files') {
        statusMessage += `\n📁 下载管理页面已自动打开，请查看下载的图片文件。`;
      } else if (request.fetchMode === 'url_only') {
        statusMessage += `\n📊 图片URL已导出为CSV文件。`;
      }

      statusArea.textContent = statusMessage;
      statusArea.className = 'message-base message-success';
    }

    // 恢复按钮状态：显示开始按钮，隐藏停止按钮
    if (fetchImagesBtn) fetchImagesBtn.style.display = 'block';
    if (stopImageFetchBtn) stopImageFetchBtn.style.display = 'none';

    // 重新启用所有按钮
    const buttons = [
      document.getElementById('startScrapeBtn'),
      document.getElementById('clearDataBtn'),
      document.getElementById('fetchImagesBtn'),
      document.getElementById('exportCsvBtn'),
      document.getElementById('exportImageUrlsBtn'),
      document.getElementById('quickTestBtn'),
      document.getElementById('getCurrentUrlBtn'),
    ];
    buttons.forEach(btn => {
      if (btn) btn.disabled = false;
    });

    // 释放操作锁（如果存在）
    if (window.operationLock && window.operationLock.release) {
      window.operationLock.release();
      console.log('批量图片抓取完成，已释放操作锁');
    }

    console.log('批量图片抓取完成，已恢复按钮状态');

    // 隐藏进度条
    const progressBar = document.getElementById('imageProgressBar');
    if (progressBar) {
      setTimeout(() => {
        progressBar.style.display = 'none';
      }, 2000);
    }
  }
}

// 处理通信超时后的状态恢复
async function handleCommunicationTimeout(message) {
  console.log('[通信超时] 开始恢复界面状态，消息:', message);

  try {
    // 根据消息类型恢复相应的界面状态
    const action = message.action;
    const actionType = _getActionType(action);

    // 后台长任务超时时，不要抢先恢复界面，避免误判任务已结束
    if (actionType === 'background_task') {
      const statusArea = document.getElementById('statusArea');
      if (statusArea) {
        statusArea.style.display = 'block';
        statusArea.textContent = '任务执行时间较长，仍在后台运行中，请继续等待进度更新';
        statusArea.className = 'message-base message-warning';
      }

      console.log('[通信超时] 后台任务仍在执行，保留当前界面状态');
      return;
    }

    // 恢复加载状态
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
      loadingIndicator.style.display = 'none';
    }

    const statusArea = document.getElementById('statusArea');
    if (statusArea) {
      statusArea.style.display = 'block';
      statusArea.textContent = '通信超时，请检查网络连接或刷新页面重试';
      statusArea.className = 'message-base message-warning';
    }

    // 根据不同的操作类型恢复按钮状态
    if (action === 'scrapeShop' || action === 'stopScraping') {
      // 恢复抓取相关按钮
      const startScrapeBtn = document.getElementById('startScrapeBtn');
      const stopScrapeBtn = document.getElementById('stopScrapeBtn');

      if (startScrapeBtn) {
        startScrapeBtn.style.display = 'block';
        startScrapeBtn.disabled = false;
      }
      if (stopScrapeBtn) {
        stopScrapeBtn.style.display = 'none';
      }

      // 隐藏进度条
      const progressBar = document.getElementById('progressBar');
      if (progressBar) {
        progressBar.style.display = 'none';
      }
    }

    if (action === 'batchFetchImages' || action === 'cancelBatchImageFetch') {
      // 恢复图片抓取相关按钮
      const fetchImagesBtn = document.getElementById('fetchImagesBtn');
      const stopImageFetchBtn = document.getElementById('stopImageFetchBtn');

      if (fetchImagesBtn) {
        fetchImagesBtn.style.display = 'block';
        fetchImagesBtn.disabled = false;
      }
      if (stopImageFetchBtn) {
        stopImageFetchBtn.style.display = 'none';
      }

      // 隐藏图片进度条
      const imageProgressBar = document.getElementById('imageProgressBar');
      if (imageProgressBar) {
        imageProgressBar.style.display = 'none';
      }
    }

    // 重新启用所有主要按钮
    const buttons = [
      document.getElementById('startScrapeBtn'),
      document.getElementById('fetchImagesBtn'),
      document.getElementById('clearDataBtn'),
      document.getElementById('exportCsvBtn'),
      document.getElementById('exportImageUrlsBtn'),
      document.getElementById('quickTestBtn'),
      document.getElementById('getCurrentUrlBtn'),
    ];
    buttons.forEach(btn => {
      if (btn) btn.disabled = false;
    });

    // 释放操作锁（如果存在）
    if (window.operationLock && window.operationLock.release) {
      window.operationLock.release();
      console.log('[通信超时] 已释放操作锁');
    }

    // 强制重置加载状态（如果UI辅助工具可用）
    if (window.ui && window.ui.forceHideLoading) {
      window.ui.forceHideLoading();
      console.log('[通信超时] 已强制重置加载状态');
    }

    console.log('[通信超时] 界面状态恢复完成');

  } catch (error) {
    console.error('[通信超时] 恢复界面状态时出错:', error);
  }
}
