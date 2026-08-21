document.getElementById("dashboard").addEventListener("click",()=>chrome.tabs.create({url:chrome.runtime.getURL("newtab.html")}));
document.getElementById("settings").addEventListener("click",()=>chrome.runtime.openOptionsPage());
for(const button of document.querySelectorAll("[data-sync]"))button.addEventListener("click",async()=>{const result=await chrome.runtime.sendMessage({type:"START_SOURCE_SYNC",platform:button.dataset.sync});document.getElementById("status").textContent=result.ok?"已打开同步页面":result.error;});
