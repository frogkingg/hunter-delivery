// 智能填充：网申表单扫描 / 高亮 / 填充执行引擎。
// 自包含 classic 脚本，经 chrome.scripting 按需注入（面板经 background 中继调用）。
// 测试：jsdom eval 后调用 globalThis.__hunterFill（无 chrome 环境自动降级）。
(function () {
  "use strict";

  const HIGHLIGHT_CLASS = "hunter-fill-highlight";
  const IS_JSDOM = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");

  // —— 内部状态 ——
  let elementRegistry = new Map(); // fieldId -> { kind, el, group?, container?, label }
  let cancelSignal = null;

  // —— 工具 ——
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cleanString = value => String(value || "").replace(/\s+/g, " ").trim().replace(/[*＊:：]\s*$/, "").replace(/\s*[*＊]\s*$/, "").trim();
  const cleanText = el => (el ? cleanString(el.textContent) : "");
  const normalizeCompare = value => String(value || "").replace(/\s+/g, "").toLowerCase();
  const escapeCss = value => String(value || "").replace(/([^a-zA-Z0-9_-])/g, "\\$1");

  function isVisible(el) {
    if (!el) return false;
    const style = el.style || {};
    if ((style.display || "").toLowerCase() === "none" || (style.visibility || "").toLowerCase() === "hidden") return false;
    if (el.hidden) return false;
    if (el.getAttribute && (el.getAttribute("aria-hidden") === "true" || el.getAttribute("type") === "hidden")) return false;
    if (el.closest && el.closest("[hidden], [aria-hidden='true'], .hidden")) return false;
    if (el.disabled) return false;
    if (IS_JSDOM) return true; // jsdom 无布局信息，跳过布局判断
    if (typeof el.offsetWidth !== "number") return true;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // label 文本：排除被包裹控件自身（如 select/textarea）的内容。
  function labelTextOf(labelEl, controlEl) {
    if (!labelEl) return "";
    let text = "";
    for (const node of labelEl.childNodes) {
      if (node === controlEl) continue;
      if (node.nodeType === 3) text += node.textContent || "";
      else if (node.nodeType === 1 && (!controlEl || !node.contains(controlEl))) text += node.textContent || "";
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function isRequired(el) {
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute("required")) return true;
    if (el.getAttribute && el.getAttribute("aria-required") === "true") return true;
    const labelText = cleanText(el.closest ? el.closest("label, .ant-form-item-label, .el-form-item__label, .control-label, .form-label") : null);
    return /必填|[*＊]/.test(labelText);
  }

  function controlLabel(el, forRadio) {
    if (!el) return { text: "", raw: "", source: "none" };
    const doc = el.ownerDocument;
    // 1. label[for=id]
    if (el.id) {
      const forLabel = doc.querySelector(`label[for="${escapeCss(el.id)}"]`);
      if (forLabel && cleanText(forLabel)) return { text: cleanText(forLabel), raw: (forLabel.textContent || "").trim(), source: "label" };
    }
    // radio 组标签：容器优先（避免把选项文本当组标签）
    if (forRadio) {
      const container = el.closest(".ant-form-item, .el-form-item, .form-item, .form-group, .field");
      if (container) {
        const labelEl = container.querySelector(".ant-form-item-label, .el-form-item__label, .control-label, .form-label, label");
        const t = labelEl ? cleanString(labelTextOf(labelEl, el)) : "";
        if (t) return { text: t, raw: (labelEl.textContent || "").trim(), source: "container" };
      }
      const prev = el.previousElementSibling;
      if (prev && /^(span|div|label|b|strong|small)$/i.test(prev.tagName)) {
        const t = cleanText(prev);
        if (t && t.length < 30) return { text: t, raw: (prev.textContent || "").trim(), source: "neighbor" };
      }
    }
    // 2. 包裹 label
    const wrap = el.closest("label");
    if (wrap) {
      const t = cleanString(labelTextOf(wrap, el));
      if (t) return { text: t, raw: (wrap.textContent || "").trim(), source: "wrap" };
    }
    // 3. aria-label
    const ariaLabel = el.getAttribute && el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return { text: ariaLabel.trim(), raw: ariaLabel, source: "aria" };
    // 4. aria-labelledby
    const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledby) {
      const texts = labelledby.split(/\s+/).map(id => doc.getElementById(id)).filter(Boolean).map(cleanText).filter(Boolean);
      if (texts.length) return { text: texts[0], raw: texts.join(" "), source: "aria" };
    }
    // 5. placeholder / title
    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) return { text: placeholder.trim(), raw: placeholder, source: "placeholder" };
    const title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return { text: title.trim(), raw: title, source: "title" };
    // 6. 前邻文本
    const prev = el.previousElementSibling;
    if (prev && /^(span|div|label|b|strong|small|h4)$/i.test(prev.tagName)) {
      const t = cleanText(prev);
      if (t && t.length < 30) return { text: t, raw: (prev.textContent || "").trim(), source: "neighbor" };
    }
    // 7. 组件库/表单容器：form-item 容器优先（自定义控件容器内往往没有标签文本）
    const formItem = el.closest(".ant-form-item, .el-form-item, .form-item, .form-group, .field");
    const widget = el.closest(".el-select, .ant-select, .el-date-editor, .ant-picker");
    const container = formItem || widget;
    if (container) {
      const labelEl = container.querySelector(".ant-form-item-label, .el-form-item__label, .control-label, .form-label, label");
      const t = labelEl ? cleanString(labelTextOf(labelEl, el)) : "";
      if (t) return { text: t, raw: (labelEl.textContent || "").trim(), source: "container" };
    }
    return { text: "", raw: "", source: "none" };
  }

  function uniquePath(el) {
    const parts = [];
    let node = el;
    const doc = el.ownerDocument;
    while (node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${escapeCss(node.id)}`);
        break;
      }
      const name = node.getAttribute && node.getAttribute("name");
      if (name) part += `[name="${escapeCss(name)}"]`;
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function classifyControl(el) {
    const tag = el.tagName.toLowerCase();
    const type = String(el.type || "text").toLowerCase();
    if (tag === "select") return { type: "select", skipped: false };
    if (tag === "textarea") return { type: "textarea", skipped: false };
    if (tag === "input") {
      if (type === "radio") return { type: "radio", skipped: false };
      if (type === "checkbox") return { type: "checkbox", skipped: false };
      if (["date", "month", "datetime-local", "time"].includes(type)) return { type: "date", skipped: false };
      if (["password", "file", "hidden", "submit", "button", "image", "reset"].includes(type)) return { type: "text", skipped: true };
      if (["tel", "email", "number", "url", "search"].includes(type)) return { type, skipped: false };
      return { type: "text", skipped: false };
    }
    return { type: "text", skipped: true };
  }

  function optionText(el) {
    if (!el) return "";
    const wrap = el.closest("label");
    if (wrap) {
      const t = cleanText(wrap);
      if (t) return t;
    }
    return String(el.value || "").trim();
  }

  // —— 扫描 ——
  function scan(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root) return { fields: [], page: null };
    const registry = new Map();
    const fields = [];
    let seq = 0;
    const controls = Array.from(root.querySelectorAll("input, select, textarea"));

    // radio 分组（按 name；无 name 的各自成组）
    const radioGroups = new Map();
    for (const el of controls) {
      if (el.type === "radio") {
        const key = el.name || `__radio_${el._hunterSeq || (el._hunterSeq = seq++)}`;
        if (!radioGroups.has(key)) radioGroups.set(key, []);
        radioGroups.get(key).push(el);
      }
    }

    for (const el of controls) {
      // radio：组内只输出第一个可见组
      if (el.type === "radio") {
        const key = el.name || `__radio_${el._hunterSeq}`;
        const group = radioGroups.get(key) || [el];
        if (group[0] !== el) continue;
        const visible = group.filter(isVisible);
        if (!visible.length) continue;
        const first = visible[0];
        const labelInfo = controlLabel(first, true);
        const fieldId = `radio-${key.replace(/\W+/g, "_") || `g${seq}`}`;
        registry.set(fieldId, { kind: "radio", el: first, group: visible, label: labelInfo.text });
        fields.push({
          id: fieldId, type: "radio", label: labelInfo.text, rawLabel: labelInfo.raw, labelSource: labelInfo.source,
          path: uniquePath(first), required: visible.some(isRequired), options: visible.map(optionText),
          value: (visible.find(r => r.checked) || { value: "" }).value || "", skipped: false,
        });
        continue;
      }

      const classified = classifyControl(el);
      const fieldId = `input-${seq++}`;

      if (classified.skipped) {
        const labelInfo = controlLabel(el);
        registry.set(fieldId, { kind: "none", el, label: labelInfo.text });
        fields.push({
          id: fieldId, type: "text", label: labelInfo.text, rawLabel: labelInfo.raw, labelSource: labelInfo.source,
          path: uniquePath(el), required: isRequired(el), options: [], value: el.value || "", skipped: true,
        });
        continue;
      }

      // 组件库自定义控件：内部 input 升级为 custom-select / custom-date
      const customContainer = el.closest(".ant-select, .el-select") || el.closest(".ant-picker, .el-date-editor");
      const finalType = customContainer
        ? (/ant-select|el-select/.test(customContainer.className) ? "custom-select" : "custom-date")
        : classified.type;

      if (!customContainer && !isVisible(el)) continue; // 隐藏原生控件不输出

      const labelInfo = controlLabel(el);
      const entry = { kind: finalType === "custom-select" || finalType === "custom-date" ? "custom" : "native", el, label: labelInfo.text };
      if (customContainer) entry.container = customContainer;
      registry.set(fieldId, entry);
      const options = finalType === "custom-select" ? collectCustomOptions(customContainer || el) : [];
      fields.push({
        id: fieldId, type: finalType, label: labelInfo.text, rawLabel: labelInfo.raw, labelSource: labelInfo.source,
        path: uniquePath(customContainer || el), required: isRequired(el), options,
        value: el.value || cleanText(customContainer || el).slice(0, 30), skipped: false,
      });
    }

    // 容器兜底：无原生控件的自定义组件（如旧版 antd select）
    for (const container of root.querySelectorAll(".ant-select, .el-select, .ant-picker, .el-date-editor")) {
      if (container.querySelector("input, select, textarea")) continue;
      if (!isVisible(container)) continue;
      const labelInfo = controlLabel(container);
      const fieldId = `custom-${seq++}`;
      const isSelect = /ant-select|el-select/.test(container.className);
      registry.set(fieldId, { kind: "custom", el: container, container, label: labelInfo.text });
      fields.push({
        id: fieldId, type: isSelect ? "custom-select" : "custom-date", label: labelInfo.text, rawLabel: labelInfo.raw,
        labelSource: labelInfo.source, path: uniquePath(container), required: isRequired(container),
        options: collectCustomOptions(container), value: cleanText(container).slice(0, 30), skipped: false,
      });
    }

    elementRegistry = registry;
    let page = null;
    try {
      const url = String(root.URL || (root.location && root.location.href) || "");
      page = { title: root.title || "", url, host: url ? new URL(url).hostname : "" };
    } catch (_) {}
    return { fields, page };
  }

  function collectCustomOptions(container) {
    const options = Array.from(container.querySelectorAll(".ant-select-selection-item, .ant-select-selection-selected-value, .el-select__selected-item, .el-input__inner"))
      .map(cleanText).filter(Boolean);
    return [...new Set(options)];
  }

  // —— 高亮 / 重置 ——
  function ensureStyle(doc) {
    if (doc.getElementById("hunter-fill-style")) return;
    const style = doc.createElement("style");
    style.id = "hunter-fill-style";
    style.textContent = `.${HIGHLIGHT_CLASS}{outline:2px solid #1d4ed8 !important;outline-offset:2px;box-shadow:0 0 0 2px rgba(29,78,216,.35)!important;}`;
    (doc.head || doc.documentElement).appendChild(style);
  }

  function highlight(ids, on, doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root) return;
    if (on) ensureStyle(root);
    for (const id of Array.isArray(ids) ? ids : []) {
      const entry = elementRegistry.get(id);
      if (!entry) continue;
      if (on) entry.el.classList.add(HIGHLIGHT_CLASS);
      else entry.el.classList.remove(HIGHLIGHT_CLASS);
    }
  }

  function reset(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (root) for (const entry of elementRegistry.values()) entry.el.classList.remove(HIGHLIGHT_CLASS);
    elementRegistry = new Map();
    cancelSignal = null;
  }

  // —— 填充执行 ——
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
  }

  function dispatchInput(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function scrollIntoView(el) {
    if (el && typeof el.scrollIntoView === "function") {
      try { el.scrollIntoView({ block: "center" }); } catch (_) {}
    }
  }

  function applyRadio(group, value) {
    const expected = normalizeCompare(value);
    const target = group.find(r => normalizeCompare(r.value) === expected)
      || group.find(r => normalizeCompare(optionText(r)) === expected)
      || group.find(r => normalizeCompare(r.value).includes(expected) || normalizeCompare(optionText(r)).includes(expected));
    if (!target) throw new Error("选项未找到");
    if (!target.checked) target.click();
    return { ok: true };
  }

  function applyCheckbox(el, value) {
    const v = normalizeCompare(value);
    if (/^(是|有|true|1|同意|愿意|会)$/.test(v)) { if (!el.checked) el.click(); return { ok: true }; }
    if (/^(否|无|false|0|不同意|不愿意|不会)$/.test(v)) { if (el.checked) el.click(); return { ok: true }; }
    throw new Error("需手动确认勾选状态");
  }

  function matchOption(options, value) {
    const expected = normalizeCompare(value);
    const exact = options.find(option => normalizeCompare(option.textContent) === expected);
    if (exact) return exact;
    return options.find(option => {
      const text = normalizeCompare(option.textContent);
      return text && (text.includes(expected) || expected.includes(text));
    }) || null;
  }

  async function applyCustomSelect(entry, value) {
    const container = entry.container || entry.el;
    const doc = container.ownerDocument;
    const selector = ".ant-select-dropdown .ant-select-item-option, .ant-select-dropdown .ant-select-item, .el-select-dropdown .el-select-dropdown__item, [role='option']";
    const options = Array.from(doc.querySelectorAll(selector)).filter(isVisible);
    const target = matchOption(options, value);
    if (target) {
      scrollIntoView(target);
      target.click();
      return { ok: true, via: "option" };
    }
    const input = container.querySelector("input");
    if (input) {
      setNativeValue(input, value);
      dispatchInput(input);
      return { ok: true, via: "input" };
    }
    throw new Error("下拉选项未找到");
  }

  function verifyValue(entry, type, value) {
    if (type === "radio") return entry.el.checked;
    if (type === "checkbox") return entry.el.checked;
    const actual = normalizeCompare(entry.el.value);
    const expected = normalizeCompare(value);
    return actual && (actual === expected || actual.includes(expected) || expected.includes(actual));
  }

  function fillOne(fill) {
    const entry = elementRegistry.get(fill.id);
    if (!entry) throw new Error("字段未找到");
    const value = String(fill.value ?? "").trim();
    if (!value) throw new Error("填充值为空");
    const type = fill.type || entry.type || "text";
    scrollIntoView(entry.el);
    if (entry.kind === "radio") {
      const result = applyRadio(entry.group, value);
      if (!verifyValue(entry, "radio", value)) throw new Error("回读校验失败");
      return result;
    }
    if (entry.kind === "custom") {
      const result = type === "custom-select" ? applyCustomSelect(entry, value) : (() => {
        const input = entry.container ? entry.container.querySelector("input") : entry.el;
        if (!input) throw new Error("自定义控件无输入框");
        setNativeValue(input, value);
        dispatchInput(input);
        return { ok: true, via: "input" };
      })();
      return result;
    }
    if (type === "checkbox") return applyCheckbox(entry.el, value);
    if (type === "select") {
      setNativeValue(entry.el, value);
      dispatchInput(entry.el);
      if (String(entry.el.value || "") !== String(value)) throw new Error("选项未找到");
      return { ok: true };
    }
    const finalValue = type === "date" && /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
    setNativeValue(entry.el, finalValue);
    dispatchInput(entry.el);
    if (!verifyValue(entry, type, finalValue)) throw new Error("回读校验失败");
    return { ok: true };
  }

  async function apply(fills, options = {}) {
    const list = Array.isArray(fills) ? fills : [];
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 100;
    const results = [];
    cancelSignal = { cancelled: false };
    const signal = options.signal || cancelSignal;
    for (let index = 0; index < list.length; index++) {
      if (signal.cancelled) break;
      const fill = list[index];
      const item = { id: fill.id, ok: false };
      try {
        Object.assign(item, fillOne(fill));
        item.ok = true;
      } catch (error) {
        item.error = error.message || String(error);
      }
      results.push(item);
      if (typeof options.onProgress === "function") {
        options.onProgress({ index: index + 1, total: list.length, id: fill.id, ok: item.ok, error: item.error });
      }
      if (index < list.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    return results;
  }

  // —— 消息监听（真实环境） ——
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        if (message.type === "SMART_FILL_SCAN") {
          const result = scan();
          sendResponse({ ok: true, fields: result.fields, page: result.page });
        } else if (message.type === "SMART_FILL_APPLY") {
          (async () => {
            try {
              const results = await apply(message.fills || [], { delayMs: 100 });
              sendResponse({ ok: true, results });
            } catch (error) {
              sendResponse({ ok: false, error: error.message || String(error), results: [] });
            }
          })();
          return true;
        } else if (message.type === "SMART_FILL_HIGHLIGHT") {
          highlight(message.ids || [], !!message.on);
          sendResponse({ ok: true });
        } else if (message.type === "SMART_FILL_CANCEL") {
          if (cancelSignal) cancelSignal.cancelled = true;
          sendResponse({ ok: true });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    });
  }

  // —— 测试 / 面板直连入口 ——
  if (typeof globalThis !== "undefined") {
    globalThis.__hunterFill = { scan, apply, highlight, reset };
  }
})();
