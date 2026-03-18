/**
 * Helper function to send log messages to the popup
 * @param {string} message - The message to send
 * @param {string} logType - The type of log (info, error, success, warning)
 */
export async function sendProgressToPopup(message, logType = 'info') {
  try {
    await chrome.runtime.sendMessage({
      action: 'logToPopup',
      message,
      logType,
    });
  } catch (error) {
    if (
      error.message.includes(
        'Could not establish connection. Receiving end does not exist.'
      )
    ) {
      console.log(`进度 (${logType}): ${message} (Popup not open)`);
    } else {
      console.error(
        '发送进度消息到popup出错 (sendProgressToPopup - utils):',
        error
      );
    }
  }
}

/**
 * 创建并显示系统通知
 * @param {string} title - 通知标题
 * @param {string} message - 通知内容
 * @param {string} type - 通知类型 (basic, image, list, progress)
 */
export function showNotification(title, message, type = 'basic') {
  const iconUrl = chrome.runtime.getURL('images/icon48.png');
  const notificationIdSuffix = Date.now();

  console.log(`[Notification] 尝试显示主通知 (带图标) - ${title}`);
  chrome.notifications.create(
    `main_notify_${notificationIdSuffix}`,
    {
      type: type,
      iconUrl: iconUrl,
      title: title,
      message: message,
    },
    notificationId => {
      if (chrome.runtime.lastError) {
        console.warn(
          `[Notification] 显示主通知失败 (ID: ${notificationId}): ${chrome.runtime.lastError.message}. 尝试备用通知。`
        );
        console.log(`[Notification] 尝试显示备用通知 (无图标) - ${title}`);
        chrome.notifications.create(
          `fallback_notify_${notificationIdSuffix}`,
          {
            type: 'basic',
            title: title,
            message: message,
            iconUrl: '',
          },
          fallbackNotificationId => {
            if (chrome.runtime.lastError) {
              console.error(
                `[Notification] 显示备用通知失败 (ID: ${fallbackNotificationId}): ${chrome.runtime.lastError.message}`
              );
            } else {
              console.log(
                `[Notification] 备用通知显示成功 (ID: ${fallbackNotificationId})`
              );
            }
          }
        );
      } else {
        console.log(`[Notification] 主通知显示成功 (ID: ${notificationId})`);
      }
    }
  );
}
