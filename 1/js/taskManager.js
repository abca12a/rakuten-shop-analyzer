// 存储任务状态的对象
export const taskStatus = {
  inProgress: false,
  lastShopCode: null,
  lastTaskCompleted: false,
  lastTaskResult: null,
  lastTaskError: null,
  shouldStop: false, // 添加停止标志
  startTime: null, // 任务开始时间
  lastUpdateTime: null, // 最后更新时间
  sessionId: null, // 会话ID用于检测重启
};

// 批量图片抓取状态（从batchImageFetcher.js导入的状态引用）
export let batchImageFetchStatus = null;

// 生成新的会话ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 当前会话ID
const currentSessionId = generateSessionId();

/**
 * 设置批量图片抓取状态引用
 */
export function setBatchImageFetchStatus(status) {
  batchImageFetchStatus = status;
}

/**
 * 保存任务状态到storage，实现持久化 - 改进版
 */
export async function saveTaskStatus() {
  try {
    // 更新最后更新时间和会话ID
    taskStatus.lastUpdateTime = Date.now();
    taskStatus.sessionId = currentSessionId;

    const statusToSave = {
      taskStatus: { ...taskStatus },
      version: '1.6.0', // 版本号用于兼容性检查
      timestamp: Date.now(),
    };

    // 如果有批量任务状态，也保存（但不保存大量数据）
    if (batchImageFetchStatus) {
      statusToSave.batchImageFetchStatus = {
        ...batchImageFetchStatus,
        products: [], // 不保存大量商品数据
        imageUrlCsvData: [], // 不保存大量URL数据
        tabIds: [], // 不保存标签页ID（重启后无效）
        lastUpdateTime: Date.now(),
        sessionId: currentSessionId,
      };
    }

    await chrome.storage.local.set(statusToSave);
    console.log('任务状态已保存到存储 (taskManager):', statusToSave);
  } catch (error) {
    console.error('保存任务状态出错 (taskManager):', error);
  }
}

/**
 * 从storage加载任务状态 - 改进版
 */
export async function loadTaskStatus() {
  try {
    const data = await chrome.storage.local.get([
      'taskStatus',
      'batchImageFetchStatus',
      'version',
      'timestamp',
    ]);

    if (data && data.taskStatus) {
      // 检查数据是否过时（超过24小时）
      const dataAge = Date.now() - (data.timestamp || 0);
      const maxAge = 24 * 60 * 60 * 1000; // 24小时

      if (dataAge > maxAge) {
        console.log('任务状态数据过时，清理旧数据 (taskManager)');
        await clearTaskStatus();
        return null;
      }

      // 检查会话ID，判断是否为同一会话
      const savedTaskStatus = data.taskStatus;
      const isNewSession = !savedTaskStatus.sessionId || savedTaskStatus.sessionId !== currentSessionId;

      if (isNewSession) {
        console.log('检测到新会话，重置运行中的任务状态 (taskManager)');
        
        // 如果是新会话，重置正在进行的任务状态
        if (savedTaskStatus.inProgress) {
          savedTaskStatus.inProgress = false;
          savedTaskStatus.shouldStop = true;
          savedTaskStatus.lastTaskError = '插件重启，任务已中断';
          savedTaskStatus.lastTaskCompleted = false;
        }
      }

      // 更新模块内的 taskStatus 对象
      Object.assign(taskStatus, savedTaskStatus);
      console.log('已从存储加载任务状态 (taskManager):', taskStatus);
    } else {
      console.log('存储中没有任务状态数据 (taskManager)');
    }

    // 处理批量任务状态
    let batchStatus = data.batchImageFetchStatus || null;
    if (batchStatus) {
      // 检查会话ID
      const isNewSessionForBatch = !batchStatus.sessionId || batchStatus.sessionId !== currentSessionId;
      
      if (isNewSessionForBatch) {
        console.log('检测到新会话，重置批量图片抓取状态 (taskManager)');
        
        // 新会话时，停止正在运行的批量任务
        if (batchStatus.isRunning) {
          batchStatus.isRunning = false;
          batchStatus.tabIds = [];
          console.log('批量图片抓取任务已因会话重启而停止');
        }
      }
    }

    return batchStatus;
  } catch (error) {
    console.error('加载任务状态出错 (taskManager):', error);
    return null;
  }
}

/**
 * 清理任务状态 - 新增方法
 */
export async function clearTaskStatus() {
  try {
    await chrome.storage.local.remove([
      'taskStatus',
      'batchImageFetchStatus',
      'version',
      'timestamp',
    ]);
    
    // 重置内存中的状态
    Object.assign(taskStatus, {
      inProgress: false,
      lastShopCode: null,
      lastTaskCompleted: false,
      lastTaskResult: null,
      lastTaskError: null,
      shouldStop: false,
      startTime: null,
      lastUpdateTime: null,
      sessionId: null,
    });
    
    console.log('任务状态已清理 (taskManager)');
  } catch (error) {
    console.error('清理任务状态出错 (taskManager):', error);
  }
}

/**
 * 强制停止所有任务 - 新增方法
 */
export async function forceStopAllTasks() {
  try {
    console.log('强制停止所有任务 (taskManager)');
    
    // 停止普通抓取任务
    if (taskStatus.inProgress) {
      taskStatus.shouldStop = true;
      taskStatus.inProgress = false;
      taskStatus.lastTaskError = '用户强制停止任务';
      taskStatus.lastTaskCompleted = false;
    }

    // 停止批量图片抓取任务
    if (batchImageFetchStatus && batchImageFetchStatus.isRunning) {
      batchImageFetchStatus.isRunning = false;
      
      // 尝试关闭所有打开的标签页
      if (batchImageFetchStatus.tabIds && batchImageFetchStatus.tabIds.length > 0) {
        const tabIdsToClose = [...batchImageFetchStatus.tabIds.map(t => t.id)];
        batchImageFetchStatus.tabIds = [];
        
        for (const tabId of tabIdsToClose) {
          try {
            await chrome.tabs.remove(tabId);
            console.log(`已关闭标签页 ${tabId}`);
          } catch (error) {
            console.warn(`关闭标签页 ${tabId} 失败:`, error.message);
          }
        }
      }
    }

    // 保存更新后的状态
    await saveTaskStatus();
    
    return { success: true, message: '所有任务已强制停止' };
  } catch (error) {
    console.error('强制停止任务出错 (taskManager):', error);
    return { success: false, error: error.message };
  }
}

/**
 * 验证任务状态一致性 - 新增方法
 */
export async function validateTaskStatus() {
  try {
    const issues = [];
    
    // 检查任务状态的一致性
    if (taskStatus.inProgress && taskStatus.shouldStop) {
      issues.push('任务状态冲突：inProgress=true 但 shouldStop=true');
    }
    
    if (taskStatus.lastTaskCompleted && taskStatus.inProgress) {
      issues.push('任务状态冲突：lastTaskCompleted=true 但 inProgress=true');
    }
    
    // 检查时间戳
    const now = Date.now();
    if (taskStatus.startTime && taskStatus.startTime > now) {
      issues.push('任务开始时间不合理（未来时间）');
    }
    
    if (taskStatus.lastUpdateTime && taskStatus.lastUpdateTime > now) {
      issues.push('任务更新时间不合理（未来时间）');
    }
    
    // 检查长时间运行的任务（超过2小时）
    if (taskStatus.inProgress && taskStatus.startTime) {
      const runningTime = now - taskStatus.startTime;
      if (runningTime > 2 * 60 * 60 * 1000) { // 2小时
        issues.push(`任务运行时间过长（${Math.round(runningTime / (60 * 1000))}分钟）`);
      }
    }

    // 如果发现问题，记录并尝试修复
    if (issues.length > 0) {
      console.warn('任务状态验证发现问题:', issues);
      
      // 自动修复一些明显的问题
      if (taskStatus.inProgress && taskStatus.shouldStop) {
        taskStatus.inProgress = false;
        taskStatus.lastTaskError = '任务状态异常，已自动停止';
      }
      
      await saveTaskStatus();
      return { valid: false, issues, fixed: true };
    }
    
    return { valid: true, issues: [], fixed: false };
  } catch (error) {
    console.error('验证任务状态出错 (taskManager):', error);
    return { valid: false, issues: [error.message], fixed: false };
  }
}

/**
 * 获取当前所有状态（供API调用） - 改进版
 */
export function getCurrentStatus() {
  const status = {
    taskStatus: { ...taskStatus },
    batchImageFetchStatus: batchImageFetchStatus
      ? {
          ...batchImageFetchStatus,
          products: [], // 不返回大量商品数据
          imageUrlCsvData: [], // 不返回大量URL数据
        }
      : null,
    systemInfo: {
      currentSessionId,
      uptime: Date.now() - (taskStatus.startTime || Date.now()),
      lastValidation: Date.now(),
    }
  };
  
  // 实时验证状态
  validateTaskStatus().catch(error => {
    console.error('状态验证失败:', error);
  });
  
  return status;
}
