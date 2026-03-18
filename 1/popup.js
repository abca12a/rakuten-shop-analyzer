/**
 * 乐天店铺数据分析器 - 主Popup脚本
 * 统一版本，整合所有功能模块
 */

import {
  sendMessageToServiceWorker,
  setupMessageListeners,
} from './src/popup/messageHandler.js';
import { exportShopDataToCSV } from './src/popup/csvExporter.js';
import {
  createUIHelpers,
  parseShopCodeFromInput,
  initializePluginVersion,
  initializeShopCodeInput,
} from './src/popup/uiHelpers.js';
import { userGuide } from './src/popup/userGuide.js';

document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== 乐天店铺数据分析器 Popup 加载开始 ===');

  // 获取DOM元素
  const shopCodeInput = document.getElementById('shopCode');
  const startScrapeBtn = document.getElementById('startScrapeBtn');
  const stopScrapeBtn = document.getElementById('stopScrapeBtn');
  const clearDataBtn = document.getElementById('clearDataBtn');
  const fetchImagesBtn = document.getElementById('fetchImagesBtn');
  const stopImageFetchBtn = document.getElementById('stopImageFetchBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportImageUrlsBtn = document.getElementById('exportImageUrlsBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const quickTestBtn = document.getElementById('quickTestBtn');
  const recoverStateBtn = document.getElementById('recoverStateBtn');
  const userGuideBtn = document.getElementById('userGuideBtn');
  const fetchRankingOption = document.getElementById('fetchRankingOption');
  const rankingSafeModeOption = document.getElementById('rankingSafeModeOption');
  const fetchTagsOption = document.getElementById('fetchTagsOption');
  const imageFetchModeSelect = document.getElementById('imageFetchModeSelect');
  const pageTimeoutInput = document.getElementById('pageTimeoutInput');

  const getCurrentUrlBtn = document.getElementById('getCurrentUrlBtn');
  const statusArea = document.getElementById('statusArea');
  const summaryResultsArea = document.getElementById('summaryResultsArea');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const pluginVersionSpan = document.getElementById('pluginVersion');
  const progressLogArea = document.getElementById('progressLogArea');


  // 创建UI辅助工具
  const ui = createUIHelpers(
    loadingIndicator,
    statusArea,
    summaryResultsArea,
    progressLogArea
  );



  // 操作锁管理器 - 防止并发操作冲突
  const operationLock = {
    isLocked: false,
    currentOperation: null,
    lockTime: null, // 🔧 新增：记录锁定时间
    timeoutId: null, // 🔧 新增：超时定时器ID

    acquire(operationName) {
      if (this.isLocked) {
        console.warn(`操作被阻止：${operationName}，当前正在执行：${this.currentOperation}`);
        return false;
      }
      this.isLocked = true;
      this.currentOperation = operationName;
      this.lockTime = Date.now(); // 🔧 新增：记录锁定时间
      console.log(`操作锁已获取：${operationName}`);

      // 🔧 新增：设置5分钟超时自动释放锁
      this.timeoutId = setTimeout(() => {
        console.warn(`操作锁超时自动释放：${this.currentOperation}`);
        this.forceRelease();
      }, 5 * 60 * 1000); // 5分钟

      return true;
    },

    release() {
      if (this.isLocked) {
        console.log(`操作锁已释放：${this.currentOperation}`);
        this.isLocked = false;
        this.currentOperation = null;
        this.lockTime = null;

        // 🔧 新增：清除超时定时器
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
          this.timeoutId = null;
        }
      }
    },

    // 🔧 新增：强制释放锁（用于异常恢复）
    forceRelease() {
      console.warn(`强制释放操作锁：${this.currentOperation || '未知操作'}`);
      this.isLocked = false;
      this.currentOperation = null;
      this.lockTime = null;

      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }

      // 恢复所有按钮状态
      buttonManager.showStartButton();
      buttonManager.showStartImageButton();
      buttonManager.enableAll();
      ui.hideLoading();
    },

    isOperationInProgress() {
      return this.isLocked;
    },

    // 🔧 新增：获取锁定时长
    getLockDuration() {
      return this.lockTime ? Date.now() - this.lockTime : 0;
    }
  };

  // 将操作锁暴露到全局，以便消息处理器可以访问
  window.operationLock = operationLock;

  // 按钮状态管理器
  const buttonManager = {
    showStopButton() {
      if (startScrapeBtn) startScrapeBtn.style.display = 'none';
      if (stopScrapeBtn) stopScrapeBtn.style.display = 'block';
    },

    showStartButton() {
      if (startScrapeBtn) startScrapeBtn.style.display = 'block';
      if (stopScrapeBtn) stopScrapeBtn.style.display = 'none';
    },

    showStopImageButton() {
      if (fetchImagesBtn) fetchImagesBtn.style.display = 'none';
      if (stopImageFetchBtn) stopImageFetchBtn.style.display = 'block';
    },

    showStartImageButton() {
      if (fetchImagesBtn) fetchImagesBtn.style.display = 'block';
      if (stopImageFetchBtn) stopImageFetchBtn.style.display = 'none';
    },

    disableAll() {
      const buttons = [
        startScrapeBtn,
        clearDataBtn,
        fetchImagesBtn,
        exportCsvBtn,
        exportImageUrlsBtn,
        quickTestBtn,
        getCurrentUrlBtn,
      ];
      buttons.forEach(btn => {
        if (btn) btn.disabled = true;
      });
    },

    enableAll() {
      const buttons = [
        startScrapeBtn,
        clearDataBtn,
        fetchImagesBtn,
        exportCsvBtn,
        exportImageUrlsBtn,
        quickTestBtn,
        getCurrentUrlBtn,
      ];
      buttons.forEach(btn => {
        if (btn) btn.disabled = false;
      });
    },
  };

  // 暴露给消息处理模块，确保后台进度和超时恢复可以同步界面状态
  window.buttonManager = buttonManager;
  window.ui = ui;

  // 初始化插件版本
  initializePluginVersion(pluginVersionSpan);

  // 初始化店铺代码输入框
  initializeShopCodeInput(shopCodeInput, ui.updateStatus);

  const popupPreferenceDefaults = {
    popupFetchRanking: true,
    popupRankingSafeMode: true,
    popupFetchTags: true,
    popupImageFetchMode: 'download_files',
    popupPageTimeout: 12000,
  };

  async function loadPopupPreferences() {
    try {
      const prefs = await chrome.storage.sync.get(popupPreferenceDefaults);
      const supportedImageFetchModes = ['download_files', 'url_only'];
      fetchRankingOption.checked = prefs.popupFetchRanking;
      rankingSafeModeOption.checked = prefs.popupRankingSafeMode;
      fetchTagsOption.checked = prefs.popupFetchTags;
      imageFetchModeSelect.value = supportedImageFetchModes.includes(
        prefs.popupImageFetchMode
      )
        ? prefs.popupImageFetchMode
        : popupPreferenceDefaults.popupImageFetchMode;
      pageTimeoutInput.value = prefs.popupPageTimeout;
      updateRankingOptionState();
    } catch (error) {
      console.warn('加载Popup偏好设置失败，使用默认值:', error);
      updateRankingOptionState();
    }
  }

  function updateRankingOptionState() {
    rankingSafeModeOption.disabled = !fetchRankingOption.checked;
  }

  function savePopupPreference(key, value) {
    chrome.storage.sync.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        console.warn(`保存Popup偏好设置失败: ${key}`, chrome.runtime.lastError);
      }
    });
  }

  await loadPopupPreferences();

  fetchRankingOption.addEventListener('change', () => {
    updateRankingOptionState();
    savePopupPreference('popupFetchRanking', fetchRankingOption.checked);
  });
  rankingSafeModeOption.addEventListener('change', () => {
    savePopupPreference('popupRankingSafeMode', rankingSafeModeOption.checked);
  });
  fetchTagsOption.addEventListener('change', () => {
    savePopupPreference('popupFetchTags', fetchTagsOption.checked);
  });
  imageFetchModeSelect.addEventListener('change', () => {
    savePopupPreference('popupImageFetchMode', imageFetchModeSelect.value);
  });
  pageTimeoutInput.addEventListener('change', () => {
    const timeoutValue = parseInt(pageTimeoutInput.value, 10) || 12000;
    pageTimeoutInput.value = timeoutValue;
    savePopupPreference('popupPageTimeout', timeoutValue);
  });

  // 设置消息监听器
  setupMessageListeners(ui.logProgress);

  // 一键抓取当前网址按钮事件
  getCurrentUrlBtn.addEventListener('click', async () => {
    console.log('=== 一键抓取当前网址按钮点击 ===');
    try {
      // 获取当前活动标签页
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs && tabs.length > 0 && tabs[0] && tabs[0].url) {
        const currentUrl = tabs[0].url;
        console.log('当前页面URL:', currentUrl);

        // 解析当前URL获取店铺代码
        const parsedShopCode = parseShopCodeFromInput(currentUrl);
        if (parsedShopCode) {
          shopCodeInput.value = parsedShopCode;
          localStorage.setItem('lastShopCode', parsedShopCode);
          ui.updateStatus(
            `已获取当前页面店铺代码: ${parsedShopCode}`,
            'success'
          );
          console.log('成功提取店铺代码:', parsedShopCode);
        } else {
          ui.updateStatus('当前页面不是有效的乐天店铺页面', 'warning');
          console.log('无法从当前URL提取店铺代码:', currentUrl);
        }
      } else {
        ui.updateStatus('无法获取当前页面信息', 'error');
        console.error('无法获取当前标签页信息');
      }
    } catch (error) {
      console.error('获取当前网址失败:', error);
      ui.updateStatus(`获取当前网址失败: ${error.message}`, 'error');
    }
  });

  // 停止抓取按钮事件
  stopScrapeBtn.addEventListener('click', async () => {
    console.log('=== 停止抓取按钮点击 ===');

    try {
      ui.updateStatus('正在停止抓取...', 'warning');

      const response = await sendMessageToServiceWorker(
        { action: 'stopScraping' },
        5000,
        1
      );

      if (response && response.success) {
        ui.updateStatus('抓取已停止', 'info');
        buttonManager.showStartButton();
        buttonManager.enableAll();
        ui.hideLoading();
        operationLock.release(); // 🔧 修复：释放操作锁
      } else {
        ui.updateStatus('停止抓取失败', 'error');
        // 停止失败时也要恢复界面状态
        buttonManager.showStartButton();
        buttonManager.enableAll();
        ui.hideLoading();
        operationLock.release(); // 🔧 修复：释放操作锁
      }
    } catch (error) {
      console.error('停止抓取失败:', error);
      ui.updateStatus(`停止抓取失败: ${error.message}`, 'error');
      // 异常时恢复界面状态
      buttonManager.showStartButton();
      buttonManager.enableAll();
      ui.hideLoading();
      operationLock.release(); // 🔧 修复：释放操作锁
    }
  });

  // 停止图片抓取按钮事件
  stopImageFetchBtn.addEventListener('click', async () => {
    console.log('=== 停止图片抓取按钮点击 ===');

    try {
      ui.updateStatus('正在停止图片抓取...', 'warning');

      const response = await sendMessageToServiceWorker(
        { action: 'cancelBatchImageFetch' },
        5000,
        1
      );

      if (response && response.success) {
        ui.updateStatus('图片抓取已停止', 'info');
        buttonManager.showStartImageButton();
        buttonManager.enableAll();
        ui.hideLoading();
        operationLock.release(); // 🔧 修复：释放操作锁
      } else {
        ui.updateStatus('停止图片抓取失败', 'error');
        // 停止失败时也要恢复界面状态
        buttonManager.showStartImageButton();
        buttonManager.enableAll();
        ui.hideLoading();
        operationLock.release(); // 🔧 修复：释放操作锁
      }
    } catch (error) {
      console.error('停止图片抓取失败:', error);
      ui.updateStatus(`停止图片抓取失败: ${error.message}`, 'error');
      // 异常时恢复界面状态
      buttonManager.showStartImageButton();
      buttonManager.enableAll();
      ui.hideLoading();
      operationLock.release(); // 🔧 修复：释放操作锁
    }
  });

  // 检查首次使用的函数
  async function checkFirstTimeUser() {
    try {
      const isFirstTime = await userGuide.isFirstTime();
      if (isFirstTime) {
        ui.updateStatus(
          '当前版本已固定连接服务器，无需填写 API 凭证，直接输入店铺代码即可开始抓取。',
          'info'
        );
        await userGuide.markCompleted();
      } else {
        await checkAndRestoreRunningTasks();
      }
    } catch (error) {
      console.error('检查首次使用状态时出错:', error);
      ui.updateStatus('状态：空闲', 'info');
    }
  }

  // 检查并恢复正在运行的任务状态
  async function checkAndRestoreRunningTasks() {
    try {
      const response = await sendMessageToServiceWorker(
        {
          action: 'getCurrentStatus',
        },
        5000,
        1
      );

      if (response && response.success && response.data) {
        const { taskStatus, batchImageFetchStatus } = response.data;

        // 恢复普通抓取任务状态
        if (taskStatus && taskStatus.inProgress) {
          ui.updateStatus(
            `正在抓取店铺 ${taskStatus.lastShopCode} 的数据...`,
            'info'
          );
          ui.showLoading(
            true,
            `正在抓取店铺 ${taskStatus.lastShopCode} 的数据...`
          );
          ui.logProgress(
            `检测到正在进行的抓取任务: ${taskStatus.lastShopCode}`
          );

          // 清除之前的结果摘要，因为任务还在进行中
          ui.clearSummary();

          // 恢复按钮状态：显示停止按钮，隐藏开始按钮
          buttonManager.showStopButton();
          buttonManager.disableAll();

          console.log('已恢复普通抓取任务的按钮状态');
        }
        // 恢复批量图片抓取状态
        else if (batchImageFetchStatus && batchImageFetchStatus.isRunning) {
          const progressText = `批量图片抓取进行中: ${batchImageFetchStatus.processedCount}/${batchImageFetchStatus.totalProducts} (已提取: ${batchImageFetchStatus.extractedCount})`;
          ui.updateStatus(progressText, 'info');
          ui.showLoading(true, `批量图片抓取进行中...`);
          ui.logProgress(
            `检测到正在进行的批量图片抓取任务: ${batchImageFetchStatus.shopCode}`
          );
          ui.logProgress(progressText);

          // 恢复按钮状态：显示停止图片抓取按钮，隐藏开始图片抓取按钮
          buttonManager.showStopImageButton();
          buttonManager.disableAll();
          console.log('已恢复批量图片抓取任务的按钮状态');

          // 显示批量抓取状态
          renderBatchImageFetchStatus(batchImageFetchStatus);
        }
        // 显示最后完成的任务结果（仅当没有任务在运行时）
        else if (
          taskStatus &&
          taskStatus.lastTaskCompleted &&
          taskStatus.lastTaskResult &&
          !taskStatus.inProgress // 确保没有任务正在运行
        ) {
          ui.updateStatus('状态：空闲，可开始新的抓取。', 'info');
          const result = taskStatus.lastTaskResult;
          if (result.success && taskStatus.lastShopCode) {
            ui.renderScrapeSuccess(
              taskStatus.lastShopCode,
              result.itemCount || 0,
              result.pagesFetched || 0
            );
          }
        }
        // 显示错误状态
        else if (taskStatus && taskStatus.lastTaskError) {
          ui.updateStatus(`上次任务失败: ${taskStatus.lastTaskError}`, 'error');
        }
        // 默认空闲状态
        else {
          ui.updateStatus('状态：空闲，可开始新的抓取。', 'info');
        }
      } else {
        ui.updateStatus('状态：空闲，可开始新的抓取。', 'info');
      }
    } catch (error) {
      console.error('恢复任务状态失败:', error);
      ui.updateStatus('状态：空闲，可开始新的抓取。', 'info');
    }
  }

  // 渲染批量图片抓取状态
  function renderBatchImageFetchStatus(status) {
    const summaryResultsArea = document.getElementById('summaryResultsArea');
    if (!summaryResultsArea) return;

    summaryResultsArea.innerHTML = `
            <div class="summary-card">
                <h3>批量图片抓取进行中</h3>
                <p>店铺: <b>${status.shopCode}</b></p>
                <p>总商品数: <b>${status.totalProducts}</b></p>
                <p>已处理: <b>${status.processedCount}</b></p>
                <p>已提取: <b>${status.extractedCount}</b></p>
                <p>抓取模式: <b>${status.fetchMode}</b></p>
                <p class="info-message">⏳ 任务正在后台执行中...</p>
            </div>
        `;
  }

  // 清空初始日志
  ui.clearProgressLog();

  // 检查是否首次使用，显示引导
  checkFirstTimeUser();

  // 🔧 新增：页面加载时检查是否有卡死的操作锁
  await checkAndRecoverStuckOperations();

  console.log('=== Popup初始化完成 ===');

  openOptionsBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.openOptionsPage();
    } catch (error) {
      console.error('打开设置页失败:', error);
      ui.updateStatus(`打开设置页失败: ${error.message}`, 'error');
    }
  });

  // 用户引导按钮事件
  userGuideBtn.addEventListener('click', () => {
    userGuide.start();
  });

  recoverStateBtn.addEventListener('click', () => {
    emergencyRecovery();
  });



  // CSV导出按钮事件
  exportCsvBtn.addEventListener('click', async () => {
    console.log('=== CSV导出开始 ===');
    const rawShopCode = shopCodeInput.value;
    const parsedShopCode = parseShopCodeFromInput(rawShopCode);
    console.log('原始店铺代码:', rawShopCode);
    console.log('解析后店铺代码:', parsedShopCode);

    if (!parsedShopCode) {
      console.log('店铺代码无效，停止导出');
      ui.updateStatus(
        '错误: 请输入有效的店铺代码或店铺URL以导出CSV。',
        'error'
      );
      ui.clearSummary();
      summaryResultsArea.innerHTML =
        '<p class="message-error" style="margin:0; text-align:left;">请输入店铺代码以导出其CSV数据。</p>';
      return;
    }

    if (parsedShopCode !== rawShopCode.trim()) {
      shopCodeInput.value = parsedShopCode;
    }
    localStorage.setItem('lastShopCode', parsedShopCode);

    console.log('开始执行CSV导出流程...');
    try {
      // 创建updateImageStatus函数
      const updateImageStatus = shopCode => {
        sendMessageToServiceWorker(
          { action: 'getShopHighResImages', shopCode: shopCode },
          10000,
          1
        )
          .then(response => {
            const imageStatusText = document.getElementById('imageStatusText');
            if (!imageStatusText) return;

            if (response && response.success) {
              if (response.backgroundTask) {
                imageStatusText.innerHTML = `<span style="color:#3498db;">ℹ 图片状态查询在后台执行中</span>`;
              } else if (response.data) {
                const totalImages = Object.keys(response.data).length;
                let totalUrls = 0;
                Object.values(response.data).forEach(images => {
                  totalUrls += images.length;
                });
                imageStatusText.innerHTML = `<span style="color:#27ae60;">✓ 已采集 ${totalImages} 个商品共 ${totalUrls} 张高分辨率图片</span>`;
              } else {
                imageStatusText.innerHTML = `<span style="color:#e67e22;">⚠ 尚未采集任何高分辨率图片</span>`;
              }
            } else {
              imageStatusText.innerHTML = `<span style="color:#e67e22;">⚠ 尚未采集任何高分辨率图片</span>`;
            }
          })
          .catch(error => {
            console.error('更新图片状态时出错:', error);
            const imageStatusText = document.getElementById('imageStatusText');
            if (imageStatusText) {
              if (error.message && error.message.includes('消息端口已关闭')) {
                imageStatusText.innerHTML = `<span style="color:#95a5a6;">⚠ 图片状态暂时无法获取</span>`;
              } else {
                imageStatusText.innerHTML = `<span style="color:#e67e22;">⚠ 获取图片状态失败</span>`;
              }
            }
          });
      };

      await exportShopDataToCSV(
        parsedShopCode,
        ui.updateStatus,
        summaryResultsArea,
        ui.showLoading,
        ui.hideLoading,
        ui.clearSummary,
        updateImageStatus
      );
      console.log('=== CSV导出成功完成 ===');
    } catch (error) {
      console.error('=== CSV导出失败 ===');
      console.error('错误详情:', error);
      console.error('错误堆栈:', error.stack);
      ui.updateStatus(`导出CSV失败: ${error.message}`, 'error');
    }
  });

  // 导出图片URL按钮事件
  exportImageUrlsBtn.addEventListener('click', async () => {
    console.log('=== 导出图片URL按钮点击 ===');
    const rawShopCode = shopCodeInput.value;
    const parsedShopCode = parseShopCodeFromInput(rawShopCode);

    if (!parsedShopCode) {
      ui.updateStatus('错误: 请输入有效的店铺代码以导出图片URL。', 'error');
      return;
    }

    try {
      ui.showLoading(true, '正在收集图片URL数据...');

      // 获取商品数据
      const productsResponse = await sendMessageToServiceWorker(
        {
          action: 'getProductsByShop',
          shopCode: parsedShopCode,
        },
        10000,
        2
      );

      if (
        !productsResponse ||
        !productsResponse.success ||
        !productsResponse.data ||
        productsResponse.data.length === 0
      ) {
        throw new Error('店铺没有商品数据，请先抓取商品数据');
      }

      // 🔧 修复：优先使用图片抓取时记录的完整URL数据
      let imageUrlData = null;

      // 首先尝试获取图片抓取时记录的完整URL数据
      try {
        const batchImageResponse = await sendMessageToServiceWorker(
          {
            action: 'getBatchImageUrlData',
            shopCode: parsedShopCode,
          },
          10000,
          2
        );

        if (batchImageResponse && batchImageResponse.success && batchImageResponse.data) {
          imageUrlData = batchImageResponse.data;
          console.log('使用图片抓取时记录的完整URL数据:', imageUrlData);
        }
      } catch (error) {
        console.warn('获取批量图片URL数据失败，尝试使用API数据:', error);
      }

      // 如果没有批量图片数据，回退到API数据（只有前3张图片）
      if (!imageUrlData) {
        const imageResponse = await sendMessageToServiceWorker(
          {
            action: 'getShopHighResImages',
            shopCode: parsedShopCode,
          },
          10000,
          2
        );

        if (!imageResponse || !imageResponse.success || !imageResponse.data) {
          throw new Error('没有找到图片数据，请先运行图片抓取功能');
        }

        imageUrlData = imageResponse.data;
        console.log('使用API数据（可能不完整）:', imageUrlData);
      }

      // 构建CSV数据
      let csvContent = 'ShopCode,ItemCode,ItemName,ImageURL,ImageIndex\n';
      let urlCount = 0;
      const products = productsResponse.data;

      products.forEach(product => {
        const itemCode = product.itemCode.split(':')[1] || product.itemCode;
        const itemName = product.itemName
          ? product.itemName
              .replace(/"/g, '""')
              .replace(/\n/g, ' ')
              .replace(/\r/g, ' ')
          : '';
        const shopCodeClean = parsedShopCode.replace(/"/g, '""');
        const itemCodeClean = itemCode.replace(/"/g, '""');

        // 🔧 修复：支持两种数据格式
        let imageUrls = [];

        // 格式1：批量图片抓取数据（完整URL列表）
        if (Array.isArray(imageUrlData)) {
          const productData = imageUrlData.find(entry =>
            entry.itemCode === itemCode && entry.shopCode === parsedShopCode
          );
          if (productData && productData.urls) {
            imageUrls = productData.urls;
          }
        }
        // 格式2：API数据（最多3张图片）
        else if (imageUrlData && imageUrlData[itemCode]) {
          const images = imageUrlData[itemCode];
          imageUrls = images.map(imageData =>
            imageData.url || imageData
          ).filter(url => url);
        }

        if (imageUrls.length > 0) {
          imageUrls.forEach((imageUrl, index) => {
            const cleanUrl = imageUrl.replace(/"/g, '""');
            csvContent += `"${shopCodeClean}","${itemCodeClean}","${itemName}","${cleanUrl}","${index + 1}"\n`;
            urlCount++;
          });
        } else {
          // 没有图片的商品也添加一行
          csvContent += `"${shopCodeClean}","${itemCodeClean}","${itemName}","","0"\n`;
        }
      });

      if (urlCount === 0) {
        throw new Error('没有找到任何图片URL数据');
      }

      // 下载CSV文件
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, '')
        .replace('T', '_');
      const filename = `rakuten_image_urls_${parsedShopCode}_${timestamp}.csv`;
      const blob = new Blob(['\uFEFF' + csvContent], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      ui.hideLoading();
      ui.updateStatus(
        `成功导出店铺 ${parsedShopCode} 的图片URL数据。`,
        'success'
      );
      summaryResultsArea.innerHTML = `
                <div class="summary-card">
                    <h3>图片URL导出成功</h3>
                    <p>店铺: <b>${parsedShopCode}</b></p>
                    <p>总商品数: <b>${products.length}</b></p>
                    <p>图片URL数量: <b>${urlCount}</b></p>
                    <p>文件名: <b>${filename}</b></p>
                    <p class="info-message">✅ CSV文件已开始下载</p>
                </div>
            `;
    } catch (error) {
      ui.hideLoading();
      console.error('导出图片URL失败:', error);
      ui.updateStatus(`导出图片URL失败: ${error.message}`, 'error');
    }
  });

  // 固定服务器模式下不再要求用户在扩展内配置 Rakuten 凭证
  async function checkApiConfiguration() {
    return true;
  }

  // 开始抓取按钮事件
  startScrapeBtn.addEventListener('click', async () => {
    console.log('=== 开始抓取按钮点击 ===');

    // 检查操作锁
    if (!operationLock.acquire('店铺数据抓取')) {
      ui.updateStatus(`无法开始抓取：正在执行 ${operationLock.currentOperation}`, 'warning');
      return;
    }

    const rawShopCode = shopCodeInput.value;
    const parsedShopCode = parseShopCodeFromInput(rawShopCode);

    if (!parsedShopCode) {
      operationLock.release(); // 释放锁
      ui.updateStatus('错误: 请输入有效的店铺代码或店铺URL。', 'error');
      return;
    }

    await checkApiConfiguration();

    if (parsedShopCode !== rawShopCode.trim()) {
      shopCodeInput.value = parsedShopCode;
    }
    localStorage.setItem('lastShopCode', parsedShopCode);

    try {
      const scrapeTimeout = fetchRankingOption.checked
        ? 15 * 60 * 1000
        : 8 * 60 * 1000;

      // 显示停止按钮
      buttonManager.showStopButton();
      buttonManager.disableAll();

      ui.showLoading(true, '正在抓取店铺 ' + parsedShopCode + ' 的数据...');
      ui.clearSummary();

      const response = await sendMessageToServiceWorker(
        {
          action: 'scrapeShop',
          shopCode: parsedShopCode,
          fetchRanking: fetchRankingOption.checked,
          fetchTags: fetchTagsOption.checked,
          rankingMode: rankingSafeModeOption.checked ? 'safe' : 'normal',
          imageFetchMode: imageFetchModeSelect.value,
          pageTimeout: parseInt(pageTimeoutInput.value, 10) || 12000,
        },
        scrapeTimeout,
        0
      );

      if (response && response.success && !response.backgroundTask && !response.duplicate) {
        // 恢复按钮状态
        buttonManager.showStartButton();
        buttonManager.enableAll();
        ui.hideLoading();
        operationLock.release(); // 释放操作锁

        ui.updateStatus(
          `成功完成抓取店铺 ${parsedShopCode} 的数据。正在自动导出CSV...`,
          'success'
        );
        ui.renderScrapeSuccess(
          parsedShopCode,
          response.itemCount || 0,
          response.pagesFetched || 0
        );

        // 🔧 修复：自动导出CSV
        try {
          await autoExportCSV(parsedShopCode);
        } catch (exportError) {
          console.error('自动导出CSV失败:', exportError);
          ui.updateStatus(
            `抓取成功，但自动导出CSV失败: ${exportError.message}。请手动点击"导出为CSV"按钮。`,
            'warning'
          );
        }
      } else if (response?.backgroundTask || response?.duplicate) {
        ui.updateStatus(
          `店铺 ${parsedShopCode} 的抓取仍在后台执行，请继续等待进度完成。`,
          'info'
        );
      } else {
        // 恢复按钮状态
        buttonManager.showStartButton();
        buttonManager.enableAll();
        ui.hideLoading();
        operationLock.release(); // 释放操作锁

        ui.updateStatus(`抓取失败: ${response?.error || '未知错误'}`, 'error');
      }
    } catch (error) {
      const isLongRunningTask = error.message?.includes('消息发送超时');

      if (isLongRunningTask) {
        console.warn('抓取任务超时，但可能仍在后台执行:', error);
        ui.updateStatus(
          `抓取耗时较长，仍在后台执行中，请继续等待进度完成或点击“停止抓取”。`,
          'warning'
        );
        return;
      }

      // 恢复按钮状态
      buttonManager.showStartButton();
      buttonManager.enableAll();
      ui.hideLoading();
      operationLock.release(); // 释放操作锁

      console.error('抓取失败:', error);
      ui.updateStatus(`抓取失败: ${error.message}`, 'error');
    }
  });



  // 清除数据按钮事件
  clearDataBtn.addEventListener('click', async () => {
    console.log('=== 清除数据按钮点击 ===');
    const rawShopCode = shopCodeInput.value;
    const parsedShopCode = parseShopCodeFromInput(rawShopCode);

    if (!parsedShopCode) {
      ui.updateStatus('错误: 请输入有效的店铺代码或店铺URL。', 'error');
      return;
    }

    if (
      !confirm(
        `确定要清除店铺 ${parsedShopCode} 的所有数据吗？此操作不可撤销。`
      )
    ) {
      return;
    }

    try {
      ui.showLoading(true, '正在清除店铺 ' + parsedShopCode + ' 的数据...');

      const response = await sendMessageToServiceWorker(
        {
          action: 'clearShopData',
          shopCode: parsedShopCode,
        },
        10000,
        2
      );

      ui.hideLoading();
      if (response && response.success) {
        // 🔧 修复：显示详细的清除信息
        const clearedInfo = response.data?.clearedItems;
        let message = `成功清除店铺 ${parsedShopCode} 的所有数据。`;

        if (clearedInfo) {
          const details = [];
          if (clearedInfo.products > 0) {
            details.push(`商品数据 ${clearedInfo.products} 个`);
          }
          if (clearedInfo.highResImages) {
            details.push('高分辨率图片数据');
          }
          if (clearedInfo.batchImageData) {
            details.push('批量抓取数据');
          }

          if (details.length > 0) {
            message += `\n清除内容：${details.join('、')}`;
          }
        }

        ui.updateStatus(message, 'success');
        ui.clearSummary();
      } else {
        ui.updateStatus(
          `清除数据失败: ${response?.error || '未知错误'}`,
          'error'
        );
      }
    } catch (error) {
      ui.hideLoading();
      console.error('清除数据失败:', error);
      ui.updateStatus(`清除数据失败: ${error.message}`, 'error');
    }
  });

  // 批量抓取高分辨率图片按钮事件
  fetchImagesBtn.addEventListener('click', async () => {
    console.log('=== 批量抓取高分辨率图片按钮点击 ===');

    // 检查操作锁
    if (!operationLock.acquire('批量图片抓取')) {
      ui.updateStatus(`无法开始图片抓取：正在执行 ${operationLock.currentOperation}`, 'warning');
      return;
    }

    const rawShopCode = shopCodeInput.value;
    const parsedShopCode = parseShopCodeFromInput(rawShopCode);

    if (!parsedShopCode) {
      operationLock.release(); // 释放锁
      ui.updateStatus('错误: 请输入有效的店铺代码或店铺URL。', 'error');
      return;
    }

    const imageFetchMode = imageFetchModeSelect.value || 'download_files';
    const pageTimeout = parseInt(pageTimeoutInput.value, 10) || 12000;
    console.log(`页面等待时间设置: ${pageTimeout}ms`);

    // 确认用户是否要批量打开页面
    const modeText =
      imageFetchMode === 'download_files'
        ? '下载图片文件'
        : imageFetchMode === 'url_only'
          ? '仅导出图片 URL CSV'
          : '下载图片文件';

    const confirmMessage = `此操作将为店铺 ${parsedShopCode} 的所有产品自动打开详情页。
依据您选择的模式 [${modeText}] 进行处理。

这将打开多个标签页并自动关闭，您可以随时点击浏览器的停止按钮中断操作。

确定继续吗？`;

    if (!confirm(confirmMessage)) {
      operationLock.release(); // 释放锁
      ui.updateStatus('批量抓取图片操作已取消。', 'info');
      return;
    }

    try {
      // 显示停止按钮
      buttonManager.showStopImageButton();
      buttonManager.disableAll();

      ui.showLoading(true, '正在启动批量图片抓取...');

      const response = await sendMessageToServiceWorker(
        {
          action: 'batchFetchImages',
          shopCode: parsedShopCode,
          fetchMode: imageFetchMode,
          autoCloseDelay: pageTimeout,
        },
        15000,
        2
      );

      if (response && response.success) {
        ui.updateStatus(`成功启动批量图片抓取任务。`, 'success');
        ui.logProgress(`批量图片抓取任务已启动，模式: ${modeText}`);
        // 保持停止按钮显示，因为任务正在后台运行
        // 注意：不在这里释放锁，因为任务正在后台运行
      } else {
        // 任务启动失败，恢复按钮状态
        buttonManager.showStartImageButton();
        buttonManager.enableAll();
        operationLock.release(); // 释放锁
        ui.updateStatus(
          `启动批量图片抓取失败: ${response?.error || '未知错误'}`,
          'error'
        );
      }
      ui.hideLoading();
    } catch (error) {
      // 任务启动失败，恢复按钮状态
      buttonManager.showStartImageButton();
      buttonManager.enableAll();
      operationLock.release(); // 释放锁
      ui.hideLoading();

      console.error('启动批量图片抓取失败:', error);
      ui.updateStatus(`启动批量图片抓取失败: ${error.message}`, 'error');
    }
  });



  // 快速测试按钮事件
  quickTestBtn.addEventListener('click', async () => {
    console.log('=== 快速测试按钮点击 ===');
    try {
      ui.showLoading(true, '正在进行系统测试...');

      const response = await sendMessageToServiceWorker(
        {
          action: 'quickTest',
        },
        10000,
        2
      );

      ui.hideLoading();
      if (response && response.success) {
        ui.updateStatus('系统测试完成，所有功能正常。', 'success');
        if (response.testResults) {
          ui.logProgress('系统测试结果:');
          response.testResults.forEach(result => {
            ui.logProgress(`- ${result}`);
          });
        }
      } else {
        ui.updateStatus(
          `系统测试失败: ${response?.error || '未知错误'}`,
          'error'
        );
      }
    } catch (error) {
      ui.hideLoading();
      console.error('系统测试失败:', error);
      ui.updateStatus(`系统测试失败: ${error.message}`, 'error');
    }
  });

  // 🔧 新增：检查并恢复卡死的操作
  async function checkAndRecoverStuckOperations() {
    try {
      // 检查是否有长时间运行的操作
      if (operationLock.isOperationInProgress()) {
        const lockDuration = operationLock.getLockDuration();
        const maxDuration = 10 * 60 * 1000; // 10分钟

        if (lockDuration > maxDuration) {
          console.warn(`检测到长时间运行的操作：${operationLock.currentOperation}，运行时间：${Math.round(lockDuration / 1000)}秒`);

          // 显示恢复提示
          ui.updateStatus(
            `⚠️ 检测到可能卡死的操作：${operationLock.currentOperation}。请点击“恢复界面”。`,
            'warning'
          );
        }
      }

      // 检查Service Worker状态
      const response = await sendMessageToServiceWorker(
        { action: 'ping' },
        3000,
        1
      ).catch(() => null);

      if (!response) {
        console.warn('Service Worker可能未响应');
        ui.updateStatus('⚠️ 后台服务可能未响应，如有问题请点击“恢复界面”。', 'warning');
      }
    } catch (error) {
      console.error('状态检查失败:', error);
    }
  }

  // 🔧 新增：紧急恢复函数
  function emergencyRecovery() {
    console.log('=== 执行紧急恢复 ===');

    // 强制释放操作锁
    operationLock.forceRelease();

    // 重置所有UI状态
    buttonManager.showStartButton();
    buttonManager.showStartImageButton();
    buttonManager.enableAll();
    ui.hideLoading();

    // 清除所有定时器和监听器
    try {
      // 发送强制停止消息到Service Worker
      sendMessageToServiceWorker(
        { action: 'forceStopAllTasks' },
        3000,
        1
      ).catch(error => {
        console.warn('发送强制停止消息失败:', error);
      });
    } catch (error) {
      console.warn('紧急恢复过程中出现错误:', error);
    }

    // 显示恢复完成消息
    ui.updateStatus('恢复完成，界面状态已重置。', 'success');

    // 3秒后清除消息
    setTimeout(() => {
      ui.updateStatus('状态：空闲', 'info');
    }, 3000);
  }

  // 🔧 修复：自动导出CSV函数 - 使用新版CSV导出器
  async function autoExportCSV(shopCode) {
    console.log(`=== 开始自动导出CSV：${shopCode} ===`);

    try {
      // 🔧 修复：创建简单的updateImageStatus函数
      const updateImageStatus = (shopCode) => {
        console.log(`[updateImageStatus] 更新图片状态: ${shopCode}`);
        // 这里可以添加图片状态更新逻辑，目前保持简单
      };

      // 🔧 修复：使用新版CSV导出器，确保包含商品描述和完整字段
      await exportShopDataToCSV(
        shopCode,
        ui.updateStatus,
        summaryResultsArea,
        ui.showLoading,
        ui.hideLoading,
        ui.clearSummary,
        updateImageStatus
      );

      console.log(`=== 自动导出CSV完成：${shopCode} ===`);
    } catch (error) {
      console.error('自动导出CSV失败:', error);
      ui.updateStatus(
        `自动导出CSV失败: ${error.message}。请手动点击"导出为CSV"按钮。`,
        'warning'
      );
      throw error;
    }
  }

  // 🔧 注释：旧版CSV导出函数已删除，现在统一使用 src/popup/csvExporter.js 中的新版导出器

  console.log('=== 乐天店铺数据分析器 Popup 加载完成 ===');
});
