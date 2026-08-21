(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_RULES = [
    { name: "AI / 机器学习", keywords: ["人工智能", "ai", "agent", "rag", "llm", "模型", "神经网络", "推理", "karpathy", "deepseek", "deepstream", "u-net"], weight: 1 },
    { name: "机器人 / 具身智能", keywords: ["机器人", "robotics", "vla", "具身", "slam", "导航", "自动驾驶"], weight: 1 },
    { name: "Linux / 操作系统", keywords: ["linux", "内核", "lfs", "操作系统", "postmarketos", "easyos"], weight: 1 },
    { name: "编程 / 软件工程", keywords: ["编程", "代码", "rust", "vibe coding", "架构", "分布式", "raft", "web", "typora", "持续集成", "ci"], weight: 1 },
    { name: "硬件 / 嵌入式", keywords: ["树莓派", "fpga", "risc-v", "开发板", "单片机", "mcu", "alu", "硬件", "物联网", "gpu", "nvidia", "amd"], weight: 0 },
    { name: "3D / 建模制造", keywords: ["3d打印", "3d 打印", "fusion 360", "fusion360", "建模", "拓竹", "cad", "omniverse", "gaussian splatting"], weight: 0 },
    { name: "学习 / 知识管理", keywords: ["学习", "阅读", "知识管理", "效率", "课程", "教程", "方法论"], weight: 0 }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function computePriorityScore(item, categoryWeights = {}, now = Date.now()) {
    let score = 50;
    if (Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5) {
      score += (item.rating - 3) * 15;
    }
    score += clamp(Number(categoryWeights[item.category] || 0), -2, 2) * 5;

    const addedAt = Number(item.addedAt || item.firstSeenAt || 0);
    if (addedAt > 0) {
      const ageDays = Math.max(0, (now - addedAt) / 86400000);
      if (ageDays <= 7) score += 10;
      else if (ageDays <= 30) score += 5;
    }

    const duration = Number(item.durationSeconds || 0);
    if (duration > 0 && duration <= 20 * 60) score += 6;
    else if (duration <= 45 * 60 && duration > 0) score += 3;
    else if (duration > 120 * 60) score -= 4;

    const progress = Number(item.progressSeconds || 0);
    if (duration > 0 && progress / duration >= 0.05 && progress / duration <= 0.8) score += 6;
    return Math.round(clamp(score, 0, 100));
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sanitizeRules(value) {
    if (!Array.isArray(value)) return DEFAULT_RULES.map(copyRule);
    const rules = value.map((rule) => ({
      name: clean(rule?.name),
      keywords: Array.isArray(rule?.keywords) ? rule.keywords.map(clean).filter(Boolean) : [],
      weight: clamp(Number(rule?.weight || 0), -2, 2)
    })).filter((rule) => rule.name && rule.keywords.length);
    return rules.length ? rules : DEFAULT_RULES.map(copyRule);
  }

  function copyRule(rule) {
    return { ...rule, keywords: [...rule.keywords] };
  }

  function classifyVideo(item, rules = DEFAULT_RULES) {
    const haystack = `${item.title || ""} ${item.creator || item.author || ""}`.toLocaleLowerCase();
    const matches = sanitizeRules(rules).map((rule, index) => {
      const score = rule.keywords.reduce((total, rawKeyword) => {
        const keyword = clean(rawKeyword).toLocaleLowerCase();
        return keyword && haystack.includes(keyword) ? total + Math.max(1, Math.min(4, keyword.length / 2)) : total;
      }, 0);
      return { name: rule.name, score, index };
    }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const localCategory = matches[0]?.name || "";
    const category = clean(item.manualCategory) || clean(item.aiCategory) || localCategory || clean(item.nativeCategory) || "待分类";
    const tags = [...new Set([
      ...(Array.isArray(item.manualTags) ? item.manualTags : []),
      ...(Array.isArray(item.aiTags) ? item.aiTags : []),
      ...matches.slice(0, 5).map((match) => match.name)
    ].map(clean).filter(Boolean))].slice(0, 12);
    return { ...item, localCategory, localTags: matches.map((match) => match.name), category, tags };
  }

  function mergeVideoRecord(existing, incoming, now = Date.now()) {
    const protectedFields = ["rating", "manualCategory", "manualTags", "aiCategory", "aiTags", "aiConfidence"];
    const merged = { ...(existing || {}) };
    for (const [key, value] of Object.entries(incoming || {})) {
      if (value !== undefined && value !== null && value !== "") merged[key] = value;
    }
    for (const key of protectedFields) {
      if (existing && Object.prototype.hasOwnProperty.call(existing, key)) merged[key] = existing[key];
    }
    merged.firstSeenAt = Number(existing?.firstSeenAt || incoming?.firstSeenAt || now);
    merged.lastSeenAt = Number(incoming?.lastSeenAt || now);
    merged.status = "current";
    return merged;
  }

  function enrichVideo(item, rules = DEFAULT_RULES, now = Date.now()) {
    const classified = classifyVideo(item, rules);
    const weights = Object.fromEntries(sanitizeRules(rules).map((rule) => [rule.name, rule.weight]));
    return { ...classified, priorityScore: computePriorityScore(classified, weights, now) };
  }

  return { DEFAULT_RULES, clamp, clean, sanitizeRules, classifyVideo, mergeVideoRecord, enrichVideo, computePriorityScore };
});
