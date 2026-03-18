/**
 * UI辅助工具模块
 * 负责处理UI状态更新、加载指示器等
 */

// UI状态管理
export function createUIHelpers(
  loadingIndicator,
  statusArea,
  summaryResultsArea,
  progressLogArea
) {
  // 加载状态计数器 - 防止多个操作同时进行时状态冲突
  let loadingCounter = 0;
  let currentLoadingMessage = '处理中...';

  function showLoading(show, message = '处理中...') {
    if (show) {
      loadingCounter++;
      currentLoadingMessage = message;
      console.log(`[加载状态] 显示加载指示器，计数器: ${loadingCounter}, 消息: ${message}`);
    } else {
      loadingCounter = Math.max(0, loadingCounter - 1);
      console.log(`[加载状态] 隐藏加载指示器，计数器: ${loadingCounter}`);
    }

    // 只有当计数器为0时才真正隐藏加载指示器
    const shouldShow = loadingCounter > 0;

    loadingIndicator.style.display = shouldShow ? 'block' : 'none';
    if (shouldShow && loadingIndicator.querySelector('p')) {
      loadingIndicator.querySelector('p').textContent = currentLoadingMessage;
    }
    statusArea.style.display = shouldShow ? 'none' : 'block';
  }

  function hideLoading() {
    showLoading(false);
  }

  // 强制重置加载状态 - 用于错误恢复
  function forceHideLoading() {
    loadingCounter = 0;
    console.log('[加载状态] 强制重置加载状态');
    loadingIndicator.style.display = 'none';
    statusArea.style.display = 'block';
  }

  // 获取当前加载状态
  function getLoadingStatus() {
    return {
      isLoading: loadingCounter > 0,
      counter: loadingCounter,
      message: currentLoadingMessage
    };
  }

  function updateStatus(message, type = 'info') {
    statusArea.textContent = message;
    statusArea.className = 'message-base';
    if (
      loadingIndicator.style.display === 'none' ||
      loadingIndicator.style.display === ''
    ) {
      statusArea.style.display = 'block';
    } else {
      statusArea.style.display = 'none';
    }

    switch (type) {
      case 'success':
        statusArea.classList.add('message-success');
        break;
      case 'error':
        statusArea.classList.add('message-error');
        break;
      case 'warning':
        statusArea.classList.add('message-warning');
        break;
      case 'info':
      default:
        statusArea.classList.add('message-info');
        break;
    }
    console.log(`状态更新 (${type}): ${message}`);
  }

  function clearSummary() {
    if (!summaryResultsArea) return;
    summaryResultsArea.innerHTML =
      '<p class="empty-state">暂无结果，完成抓取或导出后会显示在这里。</p>';
  }

  // 清空初始的占位符日志
  function clearProgressLog() {
    if (progressLogArea) {
      progressLogArea.innerHTML = '<p class="log-empty">暂无操作日志。</p>';
    }
  }

  // 函数用于向日志区域添加消息
  function logProgress(message, type = 'info') {
    if (!progressLogArea) return;
    const emptyLog = progressLogArea.querySelector('.log-empty');
    if (emptyLog) {
      emptyLog.remove();
    }
    const logEntry = document.createElement('p');
    logEntry.textContent = message;
    logEntry.style.margin = '2px 0';
    logEntry.style.padding = '0';
    if (type === 'error') {
      logEntry.style.color = '#c0392b'; // 红色表示错误
    } else if (type === 'success') {
      logEntry.style.color = '#27ae60'; // 绿色表示成功
    } else {
      logEntry.style.color = '#34495e'; // 默认颜色
    }
    progressLogArea.appendChild(logEntry);
    progressLogArea.scrollTop = progressLogArea.scrollHeight; // 自动滚动到底部
  }

  function renderScrapeSuccess(shopCode, itemCount, pagesFetched) {
    summaryResultsArea.innerHTML = `
            <div class="summary-card">
                <h3>抓取完成</h3>
                <p><strong>店铺：</strong>${shopCode}</p>
                <p><strong>商品数：</strong>${itemCount}</p>
                <p><strong>抓取页数：</strong>${pagesFetched}</p>
                <p class="info-message">数据已保存，可继续导出商品 CSV 或图片 URL CSV。</p>
            </div>
        `;
  }

  function renderNoDataSummary(shopCode) {
    summaryResultsArea.innerHTML = `
            <div class="summary-card">
                <h3>暂无已保存数据</h3>
                <p>未找到店铺 ${shopCode} 的已存储数据。</p>
            </div>
        `;
  }

  // 更新进度条函数
  function updateProgressBar(percent) {
    const progressFill = document.getElementById('imageProgressFill');
    const progressText = document.getElementById('imageProgressText');
    if (progressFill && progressText) {
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${Math.round(percent)}%`;
    }
  }

  return {
    showLoading,
    hideLoading,
    forceHideLoading,
    getLoadingStatus,
    updateStatus,
    clearSummary,
    clearProgressLog,
    logProgress,
    renderScrapeSuccess,
    renderNoDataSummary,
    updateProgressBar,
  };
}

// 店铺代码解析工具
export function parseShopCodeFromInput(inputValue) {
  if (!inputValue) return null;
  const trimmedValue = inputValue.trim();
  try {
    if (trimmedValue.startsWith('http:') || trimmedValue.startsWith('https:')) {
      const url = new URL(trimmedValue);
      const hostname = url.hostname;
      const pathname = url.pathname;

      // 支持 rakuten.co.jp 和 rakuten.ne.jp 域名
      if (
        !hostname.includes('rakuten.co.jp') &&
        !hostname.includes('rakuten.ne.jp') &&
        !hostname.includes('rakuten.com')
      ) {
        return null;
      }

      let shopCode = null;

      // 处理 https://www.rakuten.ne.jp/gold/[店铺ID]/ 格式
      if (hostname.includes('rakuten.ne.jp') && pathname.startsWith('/gold/')) {
        const match = pathname.match(/^\/gold\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          shopCode = match[1];
        }
      }
      // 处理 https://www.rakuten.co.jp/[店铺ID]/ 格式
      else if (hostname.includes('rakuten.co.jp')) {
        // 优先处理 /shop/[shopCode]/ 结构
        let match = pathname.match(/^\/shop\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          shopCode = match[1];
        } else {
          // 处理 item.rakuten.co.jp/[shopCode]/ 或 shop.rakuten.co.jp/[shopCode]/
          // 以及 www.rakuten.co.jp/[shopcode]/ (当第一部分不是 'shop'等排除词时)
          match = pathname.match(/^\/([a-zA-Z0-9_-]+)/);
          if (
            match &&
            match[1] &&
            ![
              'gold',
              'info',
              'rms',
              'event',
              'category',
              'sitemap',
              'news',
              'common',
              'test',
              'shop',
              '',
            ].includes(match[1])
          ) {
            shopCode = match[1];
          }
        }
      }

      return shopCode;
    }

    // 如果不是URL，则假定它本身就是shopCode (或无效输入)
    // 进行一些基本检查以排除明显无效的shopCode (例如包含URL特征字符或过长)
    if (
      trimmedValue.includes('/') ||
      trimmedValue.includes('.') ||
      trimmedValue.includes(':') ||
      trimmedValue.length > 50
    ) {
      // 如果它看起来像一个片段的URL或太长，则可能不是一个有效的直接shopCode
      // 这个判断可以根据实际的shopCode格式进一步细化
      if (
        !(trimmedValue.startsWith('http:') || trimmedValue.startsWith('https:'))
      ) {
        // 如果不是以http/https开头，但包含这些字符，则判定为无效
        return null;
      }
      // 对于以http/https开头但未被上面URL解析捕获或解析失败的情况，这里也应视为null
      // (理论上会被catch块捕获，但作为双重检查)
    }
    return trimmedValue.length > 0 ? trimmedValue : null;
  } catch (e) {
    //  URL构造函数失败或其他解析错误
    console.warn('解析shopCode输入时出错:', e, '输入值:', inputValue);
    // 如果尝试解析为URL失败，则不应将其视为有效的直接shopCode
    if (trimmedValue.startsWith('http:') || trimmedValue.startsWith('https:')) {
      return null;
    }
    // 如果不是以URL开头，但解析出错（不太可能进入此catch），为安全起见返回null
    return null;
  }
}

// 初始化插件版本显示
export function initializePluginVersion(pluginVersionSpan) {
  if (pluginVersionSpan) {
    pluginVersionSpan.textContent = chrome.runtime.getManifest().version;
  }
}

// 初始化店铺代码输入框
export function initializeShopCodeInput(shopCodeInput, updateStatus) {
  // 1. 从localStorage初始化shopCode输入框和状态
  const lastShopCodeFromStorage = localStorage.getItem('lastShopCode');
  if (lastShopCodeFromStorage) {
    shopCodeInput.value = lastShopCodeFromStorage;
    updateStatus('状态：空闲 (已加载上次店铺代码)', 'info');
  } else {
    updateStatus('状态：空闲', 'info');
  }

  // 2. 尝试从内容脚本获取当前页面的shopCode，并可能覆盖现有值
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs && tabs.length > 0 && tabs[0] && tabs[0].id && tabs[0].url) {
      if (
        tabs[0].url.includes('rakuten.co.jp') ||
        tabs[0].url.includes('rakuten.com')
      ) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'getShopCodeFromPage' },
          response => {
            if (chrome.runtime.lastError) {
              console.log(
                '未能从内容脚本获取shopCode:',
                chrome.runtime.lastError.message
              );
            } else if (response && response.success && response.shopCode) {
              console.log('从内容脚本获取到shopCode:', response.shopCode);
              // 如果输入框为空，或者内容脚本提供的值与当前输入框的值不同，则更新
              if (
                !shopCodeInput.value.trim() ||
                shopCodeInput.value.trim() !== response.shopCode
              ) {
                shopCodeInput.value = response.shopCode;
                localStorage.setItem('lastShopCode', response.shopCode); // 同步更新localStorage
                updateStatus(
                  `已自动填充店铺代码: ${response.shopCode}`,
                  'success'
                );
              }
            } else if (response && !response.success) {
              console.log('内容脚本未能提取shopCode:', response.error);
            }
          }
        );
      } else {
        console.log('当前标签页不是乐天域名，不尝试从内容脚本获取shopCode。');
      }
    } else {
      console.log('无法获取活动标签页信息以自动填充shopCode。');
    }
  });
}
