document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');

  function updateStatus(message, type, duration = 5000) {
    statusDiv.textContent = message;
    statusDiv.className = type;
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.className = '';
    }, duration);
  }

  chrome.storage.sync.remove(
    ['rakutenApplicationId', 'rakutenAccessKey'],
    () => {
      if (chrome.runtime.lastError) {
        console.error('清理旧 API 凭证时出错:', chrome.runtime.lastError);
        updateStatus(
          `清理旧凭证失败: ${chrome.runtime.lastError.message}`,
          'error',
          8000
        );
        return;
      }

      console.log('已清理旧的 Rakuten API 凭证');
      updateStatus(
        '当前版本固定连接 https://api.845817074.xyz，扩展内不再保存 Rakuten 凭证。',
        'success',
        8000
      );
    }
  );
});
