let settings;
document.addEventListener("DOMContentLoaded", init);

async function init() {
  const result = await send({ type: "GET_SETTINGS" });
  if (!result.ok) return setStatus(result.error, true);
  settings = result.settings; render(); bindEvents();
}

function bindEvents() {
  document.getElementById("openDashboard").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") }));
  document.getElementById("addRule").addEventListener("click", () => addRule({ name: "", keywords: [], weight: 0 }));
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("exportData").addEventListener("click", exportData);
}

function render() {
  document.getElementById("searchEngine").value = settings.searchEngine;
  document.getElementById("aiEnabled").checked = settings.ai.enabled;
  document.getElementById("aiBaseUrl").value = settings.ai.baseUrl;
  document.getElementById("aiModel").value = settings.ai.model;
  document.getElementById("aiKey").value = settings.ai.apiKey || "";
  document.getElementById("rules").replaceChildren(); settings.rules.forEach(addRule);
}

function addRule(rule) {
  const row = document.createElement("div"); row.className = "rule";
  row.append(field("分类名称", "name", rule.name), field("关键词（逗号分隔）", "keywords", (rule.keywords || []).join(", ")));
  const weight = document.createElement("label"); weight.className = "field"; const label = document.createElement("span"); label.textContent = "兴趣权重";
  const select = document.createElement("select"); select.className = "weight"; for (let i=-2;i<=2;i++) select.append(new Option(i > 0 ? `+${i}` : String(i), String(i))); select.value = String(rule.weight || 0); weight.append(label,select);
  const remove = document.createElement("button"); remove.textContent = "删除"; remove.addEventListener("click", () => row.remove()); row.append(weight,remove); document.getElementById("rules").append(row);
}

function field(labelText, className, value) { const label=document.createElement("label"); label.className="field"; const span=document.createElement("span"); span.textContent=labelText; const input=document.createElement("input"); input.className=className; input.value=value||""; label.append(span,input); return label; }

async function save() {
  const rules = [...document.querySelectorAll(".rule")].map((row) => ({ name: row.querySelector(".name").value.trim(), keywords: row.querySelector(".keywords").value.split(/[,，]/).map((x)=>x.trim()).filter(Boolean), weight: Number(row.querySelector(".weight").value) })).filter((rule)=>rule.name&&rule.keywords.length);
  if (!rules.length) return setStatus("至少保留一个有效分类规则", true);
  const ai = { enabled: document.getElementById("aiEnabled").checked, baseUrl: document.getElementById("aiBaseUrl").value.trim(), model: document.getElementById("aiModel").value.trim(), apiKey: document.getElementById("aiKey").value };
  if (ai.enabled) {
    let origin; try { const url = new URL(ai.baseUrl); origin = `${url.protocol}//${url.hostname}/*`; } catch { return setStatus("AI Base URL 无效", true); }
    const granted = await chrome.permissions.request({ origins: [origin] }); if (!granted) return setStatus("未获得 AI 接口来源权限", true);
  }
  const result = await send({ type:"SAVE_SETTINGS", settings:{ rules, searchEngine:document.getElementById("searchEngine").value, ai } });
  if (!result.ok) return setStatus(result.error,true); settings=result.settings; setStatus("设置已保存，资料库已重新计算");
}

async function exportData() { const result=await send({type:"EXPORT_LIBRARY"}); if(!result.ok)return setStatus(result.error,true); download(JSON.stringify(result.payload,null,2),`watchboard-backup-${new Date().toISOString().slice(0,10)}.json`); }
function download(content,filename){const url=URL.createObjectURL(new Blob([content],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function setStatus(text,error=false){const node=document.getElementById("status");node.textContent=text;node.style.color=error?"#b23d50":"#378057";}
function send(payload){return chrome.runtime.sendMessage(payload).catch((error)=>({ok:false,error:String(error?.message||error)}));}
