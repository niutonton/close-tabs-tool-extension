chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed or updated.');
    if (details.reason === 'update') {
        const previousVersion = details.previousVersion;
        console.log(`Updated from ${previousVersion} to ${chrome.runtime.getManifest().version}`);
        // Open the update page
        chrome.tabs.create({
            url: 'update.html'
        });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'createNewWindow') {
    chrome.windows.create({
      // You can specify URL, size, etc. here if needed
    });
  }
});

// Listen for when an update is available
chrome.runtime.onUpdateAvailable.addListener((details) => {
  console.log("Update available: ", details.version);
  // Show a notification to the user
  chrome.notifications.create('update-notification', {
    type: 'basic',
    iconUrl: 'icon128.png',
    title: '扩展程序有新版本！',
    message: `新版本 ${details.version} 已准备就绪，点击“立即更新”以应用。`,
    buttons: [
      { title: '立即更新' }
    ],
    priority: 2 // High priority
  });
});

// Listen for the user clicking the button in the notification
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === 'update-notification' && buttonIndex === 0) {
    // Reload the extension to apply the update
    chrome.runtime.reload();
  }
});
