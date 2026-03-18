/**
 * 欢迎页面的JavaScript功能
 */

function openPopup() {
  // 尝试打开插件popup
  if (chrome && chrome.action) {
    chrome.action.openPopup();
  } else {
    alert('请点击浏览器工具栏中的插件图标打开主界面');
  }
}

function openOptions() {
  // 打开选项页面
  if (chrome && chrome.runtime) {
    chrome.runtime.openOptionsPage();
  } else {
    alert('请在扩展环境中打开设置页并确认服务器连接信息');
  }
}

// 页面加载完成后的处理
document.addEventListener('DOMContentLoaded', function () {
  console.log('乐天店铺数据分析器欢迎页面加载完成');

  // 添加事件监听器
  const popupBtn = document.querySelector('[data-action="popup"]');
  const optionsBtn = document.querySelector('[data-action="options"]');

  if (popupBtn) {
    popupBtn.addEventListener('click', openPopup);
  }

  if (optionsBtn) {
    optionsBtn.addEventListener('click', openOptions);
  }
});
