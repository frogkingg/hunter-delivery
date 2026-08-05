// 智能填充：网申表单扫描 / 高亮 / 填充执行引擎。
// 自包含 classic 脚本，经 chrome.scripting 按需注入（面板经 background 中继调用）。
// 测试：jsdom eval 后调用 globalThis.__hunterFill（无 chrome 环境自动降级）。
(function () {
  "use strict";

  const ENGINE_VERSION = 3;
  const HIGHLIGHT_CLASS = "hunter-fill-highlight";
  const IS_JSDOM = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
  const SECTION_DEFINITIONS = [
    { key: "education", arrayKey: "education", title: "教育经历", pattern: /教育背景|教育经历|education/i, idPattern: /educations?|resume[-_]?form[-_]?edu/i },
    { key: "internship", arrayKey: "internships", title: "实习经历", pattern: /实习经历|实习经验|internships?/i, idPattern: /internships?|resume[-_]?form[-_]?intern/i },
    { key: "work", arrayKey: "workHistory", title: "工作经历", pattern: /工作经历|工作经验|work\s*(?:history|experience)/i, idPattern: /work[-_]?(?:history|experiences?)?|resume[-_]?form[-_]?work/i },
    { key: "project", arrayKey: "projects", title: "项目经历", pattern: /项目经历|项目经验|projects?/i, idPattern: /projects?|resume[-_]?form[-_]?project/i },
    { key: "award", arrayKey: "awardEntries", title: "获奖经历", pattern: /获奖经历|获奖情况|荣誉奖项|awards?|honors?/i, idPattern: /awards?|honors?|resume[-_]?form[-_]?award/i },
    { key: "language", arrayKey: "languageEntries", title: "语言能力", pattern: /语言能力|语言经历|外语能力|languages?/i, idPattern: /languages?|resume[-_]?form[-_]?language/i },
    { key: "game", arrayKey: "gameExperiences", title: "游戏经历", pattern: /游戏经历|游戏经验|game\s*experience/i, idPattern: /game[-_]?experiences?|info[-_]?game[-_]?experience[-_]?list/i },
  ];

  // —— 内部状态 ——
  let elementRegistry = new Map(); // fieldId -> { kind, el, group?, container?, label }
  let repeaterRegistry = new Map(); // repeaterId -> { el, arrayKey, fingerprint, locators }
  let cancelSignal = null;
  let scanSession = null;
  let structureObserver = null;
  let scanSequence = 0;
  let indexedDocument = null;
  let labelForIndex = new Map();
  let idCountIndex = new Map();

  // —— 工具 ——
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cleanString = value => String(value || "").replace(/\s+/g, " ").trim().replace(/[*＊:：]\s*$/, "").replace(/\s*[*＊]\s*$/, "").trim();
  const cleanText = el => (el ? cleanString(el.textContent) : "");
  const normalizeCompare = value => String(value || "").replace(/\s+/g, "").toLowerCase();
  const escapeCss = value => String(value || "").replace(/([^a-zA-Z0-9_-])/g, "\\$1");
  const stableHash = value => {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
  };

  // 增量续填：已见字段标记。初始扫描与每次填充都会打标，onlyNew 扫描据此排除旧字段。
  const PROCESSED_ATTR = "data-hunter-seen";
  function markElementProcessed(el) {
    if (!el || typeof el.setAttribute !== "function") return;
    const custom = typeof el.closest === "function" ? el.closest(".ant-select, .el-select, .ant-picker, .el-date-editor") : null;
    const root = custom || el;
    try { root.setAttribute(PROCESSED_ATTR, "1"); } catch (_) {}
  }
  function isElementProcessed(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute(PROCESSED_ATTR)) return true;
    const custom = typeof el.closest === "function" ? el.closest(".ant-select, .el-select, .ant-picker, .el-date-editor") : null;
    return !!(custom && custom.getAttribute && custom.getAttribute(PROCESSED_ATTR));
  }

  function prepareDocumentIndexes(doc) {
    indexedDocument = doc;
    labelForIndex = new Map();
    idCountIndex = new Map();
    for (const label of doc.querySelectorAll("label[for]")) {
      const key = label.getAttribute("for");
      if (key && !labelForIndex.has(key)) labelForIndex.set(key, label);
    }
    for (const el of doc.querySelectorAll("[id]")) {
      idCountIndex.set(el.id, (idCountIndex.get(el.id) || 0) + 1);
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const style = el.style || {};
    if ((style.display || "").toLowerCase() === "none" || (style.visibility || "").toLowerCase() === "hidden") return false;
    if (el.hidden) return false;
    if (el.getAttribute && (el.getAttribute("aria-hidden") === "true" || el.getAttribute("type") === "hidden")) return false;
    if (el.closest && el.closest("[hidden], [aria-hidden='true'], .hidden, .ant-select-dropdown-hidden")) return false;
    if (el.disabled) return false;
    if (IS_JSDOM) return true; // jsdom 无布局信息，跳过布局判断
    if (typeof el.offsetWidth !== "number") return true;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function isPhoneLikeInput(input) {
    if (!input || String(input.tagName || "").toLowerCase() !== "input") return false;
    const type = String(input.type || "").toLowerCase();
    const inputmode = String(input.getAttribute?.("inputmode") || "").toLowerCase();
    const semantic = [
      input.id,
      input.getAttribute?.("name"),
      input.getAttribute?.("autocomplete"),
      input.getAttribute?.("placeholder"),
      input.getAttribute?.("aria-label"),
    ].filter(Boolean).join(" ");
    return ["tel", "number"].includes(type)
      || ["tel", "numeric", "decimal"].includes(inputmode)
      || /手机|电话/.test(semantic)
      || /(?:^|[^a-z])(phone|mobile|tel)(?:[^a-z]|$)/i.test(semantic);
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

  // 非语义化表单常把「字段标题」和控件放在同一容器的两个兄弟节点中，
  // 但不用 label/for（例如 CSS Modules 生成的 itemInputBox/label 类名）。
  // 从控件向上逐层寻找：包含控件的直接子树之前，最近的无控件短文本节点。
  function nearbyFieldLabel(el, forRadio = false) {
    if (!el?.parentElement) return null;
    let branch = el;
    for (let depth = 0; depth < 6 && branch?.parentElement; depth++) {
      const container = branch.parentElement;
      if (/^(body|html|form)$/i.test(container.tagName)) break;
      const radios = container.querySelectorAll?.("input[type='radio']") || [];
      const children = Array.from(container.children || []);
      const branchIndex = children.findIndex(child => child === branch || child.contains(branch));
      const candidates = branchIndex >= 0 ? children.slice(0, branchIndex).reverse() : [];
      for (const candidate of candidates) {
        if (candidate.querySelector?.("input, select, textarea")) continue;
        const text = cleanText(candidate);
        if (!text || text.length > 40 || /^(请填写|请输入|请选择|--)$/.test(text)) continue;
        // radio 必须先上溯到包含多个选项的共同字段容器，避免把「男生」当成组名。
        if (forRadio && radios.length < 2) continue;
        const controls = Array.from(container.querySelectorAll("input:not([type='hidden']), select, textarea"));
        if (!forRadio && controls.length > 1) {
          const phoneCompound = /手机|电话|phone|mobile|tel/i.test(text)
            && !!container.querySelector(".ant-select, .el-select, select")
            && controls.some(isPhoneLikeInput);
          if (!phoneCompound) continue;
        }
        return { text, raw: (candidate.textContent || "").trim(), source: "container", container };
      }
      branch = container;
    }
    return null;
  }

  function unnamedRadioGroupContainer(el) {
    let node = el?.parentElement;
    for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
      if (/^(body|html|form)$/i.test(node.tagName)) break;
      if (node.querySelectorAll("input[type='radio']").length > 1) return node;
    }
    return null;
  }

  function logicalFieldContainer(el) {
    let node = el?.parentElement;
    for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
      if (/^(body|html|form)$/i.test(node.tagName)) break;
      const controls = node.querySelectorAll("input:not([type='hidden']), select, textarea");
      const hasKnownShape = node.matches?.(".ant-form-item, .el-form-item, .form-item, .form-group, .field, [class*='itemInputBox'], [class*='formItem']");
      if (hasKnownShape || controls.length > 1) {
        const label = Array.from(node.children || []).find(child =>
          !child.matches?.("input, select, textarea")
          && !child.querySelector?.("input, select, textarea")
          && cleanText(child)
          && cleanText(child).length <= 40
        );
        if (label || hasKnownShape) return node;
      }
    }
    return null;
  }

  function containerLabelInfo(container, control) {
    if (!container) return { text: "", raw: "", source: "none" };
    const candidates = [
      ...container.querySelectorAll(".ant-form-item-label, .el-form-item__label, .control-label, .form-label, label"),
      ...Array.from(container.children || []).filter(child => !child.querySelector?.("input, select, textarea")),
    ];
    for (const candidate of candidates) {
      const text = cleanString(labelTextOf(candidate, control));
      if (text && text.length <= 40) {
        return { text, raw: (candidate.textContent || "").trim(), source: "container", container };
      }
    }
    return { text: "", raw: "", source: "none" };
  }

  function phoneComposite(container, target) {
    const fieldContainer = logicalFieldContainer(container || target);
    if (!fieldContainer) return null;
    const labelInfo = containerLabelInfo(fieldContainer, target);
    const controls = Array.from(fieldContainer.querySelectorAll("input:not([type='hidden']), select, textarea"));
    const phoneInput = isPhoneLikeInput(target)
      ? target
      : controls.find(control =>
        control !== target
        && !(container && container.contains(control))
        && isPhoneLikeInput(control)
      );
    const semantic = `${labelInfo.text} ${fieldContainer.id || ""} ${fieldContainer.className || ""}`;
    if (!phoneInput || !/手机|电话|phone|mobile|tel/i.test(semantic)) return null;
    return { container: fieldContainer, labelInfo, phoneInput };
  }

  function selectCompound(widget, target) {
    const fieldContainer = logicalFieldContainer(widget || target);
    if (!fieldContainer) return null;
    const selectContainer = widget?.matches?.(".ant-select, .el-select, select")
      ? widget
      : fieldContainer.querySelector(".ant-select, .el-select, select");
    if (!selectContainer) return null;
    const valueInput = Array.from(fieldContainer.querySelectorAll("input:not([type='hidden']), textarea"))
      .find(control => !selectContainer.contains(control) && !["radio", "checkbox"].includes(String(control.type || "").toLowerCase()));
    const labelInfo = containerLabelInfo(fieldContainer, target);
    if (!valueInput || !labelInfo.text) return null;
    return { container: fieldContainer, selectContainer, valueInput, labelInfo };
  }

  function isPhoneCountryCodeControl(container, target, labelInfo) {
    if (phoneComposite(container, target)) return true;
    if (!/手机|电话|phone|mobile|tel/i.test(String(labelInfo?.text || ""))) return false;
    let node = container?.parentElement;
    for (let depth = 0; depth < 5 && node; depth++, node = node.parentElement) {
      const siblingPhone = Array.from(node.querySelectorAll("input")).some(input =>
        input !== target && !container.contains(input) && /^(tel|number)$/.test(String(input.type || "").toLowerCase())
      );
      if (siblingPhone) return true;
      if (/^(body|html|form)$/i.test(node.tagName)) break;
    }
    return false;
  }

  function isRequired(el) {
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute("required")) return true;
    if (el.getAttribute && el.getAttribute("aria-required") === "true") return true;
    const labelText = cleanText(el.closest ? el.closest("label, .ant-form-item-label, .el-form-item__label, .control-label, .form-label") : null);
    const nearbyText = nearbyFieldLabel(el)?.raw || "";
    return /必填|[*＊]/.test(`${labelText} ${nearbyText}`);
  }

  function controlLabel(el, forRadio) {
    if (!el) return { text: "", raw: "", source: "none" };
    const doc = el.ownerDocument;
    // 1. label[for=id]
    if (el.id) {
      const forLabel = indexedDocument === doc ? labelForIndex.get(el.id) : doc.querySelector(`label[for="${escapeCss(el.id)}"]`);
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
      const nearby = nearbyFieldLabel(el, true);
      if (nearby) return nearby;
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
    // 5. 非语义化字段容器中的前置标签；应优先于「请填写」等无区分度 placeholder。
    const nearby = nearbyFieldLabel(el);
    if (nearby) return nearby;
    // 6. placeholder / title
    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) return { text: placeholder.trim(), raw: placeholder, source: "placeholder" };
    const title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return { text: title.trim(), raw: title, source: "title" };
    // 7. 前邻文本
    const prev = el.previousElementSibling;
    if (prev && /^(span|div|label|b|strong|small|h4)$/i.test(prev.tagName)) {
      const t = cleanText(prev);
      if (t && t.length < 30) return { text: t, raw: (prev.textContent || "").trim(), source: "neighbor" };
    }
    // 8. 组件库/表单容器：form-item 容器优先（自定义控件容器内往往没有标签文本）。
    //    仅当容器内控件唯一时采用容器标签，避免一个容器里多个控件共用同一标签导致错配。
    const formItem = el.closest(".ant-form-item, .el-form-item, .form-item, .form-group, .field");
    const widget = el.closest(".el-select, .ant-select, .el-date-editor, .ant-picker");
    const container = formItem || widget;
    if (container) {
      const labelEl = container.querySelector(".ant-form-item-label, .el-form-item__label, .control-label, .form-label, label");
      const t = labelEl ? cleanString(labelTextOf(labelEl, el)) : "";
      const directControls = container.querySelectorAll("input:not([type='hidden']):not([type='radio']), select, textarea").length;
      const radioNames = new Set([...container.querySelectorAll("input[type='radio']")].map(radio => radio.name || ""));
      const controlUnits = directControls + radioNames.size;
      if (t && controlUnits <= 1) return { text: t, raw: (labelEl.textContent || "").trim(), source: "container" };
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

  function sectionDefinitionFromText(text) {
    const value = cleanString(text);
    if (!value) return null;
    return SECTION_DEFINITIONS.find(definition => definition.pattern.test(value)) || null;
  }

  function directSectionHeading(container) {
    const candidates = Array.from(container?.children || []).filter(child => {
      if (child.matches?.("input, select, textarea, label")) return false;
      if (child.querySelector?.("input, select, textarea")) return false;
      const tag = String(child.tagName || "").toLowerCase();
      const cls = String(child.className || "");
      return /^h[1-6]$/.test(tag) || /(?:^|[-_])(title|header|heading)(?:[-_]|$)/i.test(cls);
    });
    return candidates.find(candidate => sectionDefinitionFromText(cleanText(candidate))) || null;
  }

  function sectionInfo(el) {
    let node = el?.parentElement;
    for (let depth = 0; depth < 20 && node; depth++, node = node.parentElement) {
      const heading = directSectionHeading(node);
      const definition = sectionDefinitionFromText(cleanText(heading));
      if (definition) return { definition, text: cleanText(heading), root: node };
      const semantic = `${node.id || ""} ${node.getAttribute?.("data-section") || ""} ${node.className || ""}`;
      const byAttribute = SECTION_DEFINITIONS.find(item => item.idPattern.test(semantic));
      if (byAttribute && !/ant-form-item|el-form-item/i.test(String(node.className || ""))) {
        return { definition: byAttribute, text: byAttribute.title, root: node };
      }
      if (/^(body|html)$/i.test(node.tagName)) break;
    }
    return null;
  }

  function repeatContext(el, section) {
    const identity = [
      el?.id,
      el?.getAttribute?.("name"),
      el?.getAttribute?.("data-field"),
    ].filter(Boolean).join(" ");
    const indexedContainer = el?.closest?.("[data-entry-index]");
    const containerIdentity = indexedContainer
      ? `${indexedContainer.id || ""} ${indexedContainer.className || ""}`
      : "";
    const definitions = section?.definition ? [section.definition, ...SECTION_DEFINITIONS] : SECTION_DEFINITIONS;
    for (const definition of definitions) {
      if (!definition.idPattern.test(`${identity} ${containerIdentity}`) && section?.definition !== definition) continue;
      const explicit = identity.match(/(?:^|[_[])(\d+)(?:[_\]]|$)/);
      const dataIndex = indexedContainer?.getAttribute("data-entry-index");
      const rawIndex = dataIndex ?? explicit?.[1];
      if (rawIndex !== undefined && rawIndex !== null && /^\d+$/.test(String(rawIndex))) {
        return { arrayKey: definition.arrayKey, itemIndex: Number(rawIndex) };
      }
    }
    return null;
  }

  function fieldContext(el) {
    const form = el.closest && el.closest("form");
    const fieldset = el.closest && el.closest("fieldset");
    const formItem = el.closest && el.closest(".ant-form-item, .el-form-item, .form-item, .form-group, .field");
    const legend = fieldset && fieldset.querySelector("legend");
    const groupLabel = formItem && formItem.querySelector(".ant-form-item-label, .el-form-item__label, .control-label, .form-label, label");
    const section = sectionInfo(el);
    return {
      formKey: form ? (form.id || form.getAttribute("name") || form.getAttribute("action") || "") : "",
      section: cleanText(legend) || section?.text || "",
      sectionKey: section?.definition?.key || "",
      group: groupLabel ? cleanString(labelTextOf(groupLabel, el)) : "",
      repeat: repeatContext(el, section),
    };
  }

  function semanticAttributes(el) {
    const get = name => el && el.getAttribute ? String(el.getAttribute(name) || "") : "";
    return {
      tag: String(el?.tagName || "").toLowerCase(),
      inputType: String(el?.type || "").toLowerCase(),
      id: String(el?.id || ""),
      name: get("name"),
      autocomplete: get("autocomplete"),
      inputmode: get("inputmode"),
      role: get("role"),
      placeholder: get("placeholder"),
      ariaLabel: get("aria-label"),
      ariaControls: get("aria-controls") || get("aria-owns"),
    };
  }

  function collectEvidence(el, labelInfo, context, semanticHint = "") {
    const attributes = semanticAttributes(el);
    const evidence = [];
    const add = (source, text, weight) => {
      const value = cleanString(text);
      if (!value) return;
      const normalized = normalizeCompare(value);
      if (evidence.some(item => item.source === source && item.normalized === normalized)) return;
      evidence.push({ source, text: value, normalized, weight });
    };
    add(labelInfo.source || "label", labelInfo.text, 90);
    add("aria", attributes.ariaLabel, 90);
    add("autocomplete", attributes.autocomplete, 100);
    add("name", attributes.name, 75);
    add("id", attributes.id, 70);
    add("placeholder", attributes.placeholder, 55);
    add("inputmode", attributes.inputmode, 60);
    add("semantic", semanticHint, 95);
    add("section", context.section, 35);
    add("group", context.group, 45);
    return evidence;
  }

  function fieldFingerprintOf(el, type, slot, forRadio) {
    const labelInfo = controlLabel(el, !!forRadio);
    const context = fieldContext(el);
    const attributes = semanticAttributes(el);
    return stableHash(JSON.stringify({
      type,
      slot: slot ?? "single",
      label: normalizeCompare(labelInfo.text),
      context: {
        formKey: normalizeCompare(context.formKey),
        section: normalizeCompare(context.section),
        sectionKey: context.sectionKey,
        group: normalizeCompare(context.group),
        repeat: context.repeat,
      },
      attributes,
    }));
  }

  function locatorBundle(el) {
    const doc = el.ownerDocument;
    const locators = [];
    const idCount = indexedDocument === doc ? idCountIndex.get(el.id) : doc.querySelectorAll(`#${escapeCss(el.id)}`).length;
    if (el.id && idCount === 1) {
      locators.push({ kind: "id", value: el.id, score: 100 });
    }
    const name = el.getAttribute && el.getAttribute("name");
    if (name) locators.push({ kind: "name", value: name, tag: String(el.tagName || "").toLowerCase(), score: 80 });
    const path = uniquePath(el);
    if (path) locators.push({ kind: "css", value: path, score: 30 });
    return locators;
  }

  function nodeTouchesControl(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches && node.matches("input, select, textarea, form")) return true;
    return !!(node.querySelector && node.querySelector("input, select, textarea, form"));
  }

  function installStructureObserver(root) {
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
    if (typeof MutationObserver === "undefined" || !root?.documentElement) return;
    structureObserver = new MutationObserver(records => {
      if (!scanSession) return;
      const changed = records.some(record => {
        if (record.type === "attributes") return true;
        return [...record.addedNodes, ...record.removedNodes].some(nodeTouchesControl);
      });
      if (changed) scanSession.dirty = true;
    });
    structureObserver.observe(root.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["id", "name", "type", "role", "aria-label", "aria-labelledby", "aria-controls", "aria-owns", "autocomplete", "inputmode", "placeholder"],
    });
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

  function dateMetaForNative(el) {
    const nativeType = String(el?.type || "date").toLowerCase();
    return {
      framework: "native",
      nativeType,
      mode: nativeType === "datetime-local" ? "datetime" : nativeType,
      requiresConfirm: false,
    };
  }

  function dateMetaForCustom(container, target) {
    const className = `${container?.className || ""} ${target?.className || ""}`.toLowerCase();
    const semantic = [
      className,
      target?.getAttribute?.("placeholder"),
      target?.getAttribute?.("aria-label"),
      container?.getAttribute?.("data-type"),
      container?.getAttribute?.("data-picker"),
    ].filter(Boolean).join(" ").toLowerCase();
    const framework = /ant-picker/.test(className)
      ? "antd"
      : /el-date-editor/.test(className) ? "element" : "generic";
    const mode = /datetime|日期时间/.test(semantic)
      ? "datetime"
      : /(?:^|[-_\s])time(?:$|[-_\s])|时间选择/.test(semantic)
        ? "time"
        : /month|月份|年月/.test(semantic)
          ? "month"
          : /year|年份|年度/.test(semantic) ? "year" : "date";
    return {
      framework,
      nativeType: "",
      mode,
      requiresConfirm: /need-confirm|show-time|confirm/.test(semantic),
    };
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
  function scan(doc, scanOptions = {}) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root) return { fields: [], page: null };
    prepareDocumentIndexes(root);
    const registry = new Map();
    const fields = [];
    let seq = 0;
    const controls = Array.from(root.querySelectorAll("input, select, textarea"));
    const processedControls = new Set();

    const addField = ({
      fieldId, type, target, labelInfo, options = [], value = "", skipped = false,
      kind = "native", group = null, container = null, adapter = "native", slot = "single",
      required = isRequired(target), semanticHint = "", optionsComplete = false, contextOverride = null,
      dateMeta = null,
    }) => {
      const markRoot = container || target;
      if (scanOptions.onlyUnprocessed && isElementProcessed(markRoot)) return;
      if (!scanOptions.dryRun) markElementProcessed(markRoot);
      const context = { ...fieldContext(target), ...(contextOverride || {}) };
      const evidence = collectEvidence(target, labelInfo, context, semanticHint);
      const attributes = semanticAttributes(target);
      const fingerprint = fieldFingerprintOf(target, type, slot, kind === "radio");
      const path = uniquePath(target);
      const locators = locatorBundle(target);
      const descriptor = {
        id: fieldId,
        type,
        label: labelInfo.text,
        rawLabel: labelInfo.raw,
        labelSource: labelInfo.source,
        path,
        required,
        options,
        optionsComplete,
        value,
        skipped,
        fingerprint,
        evidence,
        context,
        attributes,
        adapter,
        slot,
        dateMeta,
        semanticHint,
        locators,
      };
      registry.set(fieldId, {
        kind,
        el: target,
        group,
        container,
        label: labelInfo.text,
        path,
        locators,
        type,
        adapter,
        slot,
        dateMeta,
        fingerprint,
      });
      fields.push(descriptor);
    };

    // 自定义组件先按逻辑 root 扫描。一个 root 可以有多个明确 slot（如日期范围 start/end）。
    for (const container of root.querySelectorAll(".ant-select, .el-select, .ant-picker, .el-date-editor")) {
      if (!isVisible(container)) continue;
      const isSelect = /(?:^|\s)(?:ant-select|el-select)(?:\s|$)/.test(String(container.className || ""));
      const internal = Array.from(container.querySelectorAll("input, select, textarea"));
      internal.forEach(control => processedControls.add(control));
      const visibleTargets = internal.filter(control => control.type !== "hidden" && isVisible(control));
      if (isSelect) {
        const target = visibleTargets[0] || container;
        let labelInfo = controlLabel(target);
        const containerLabel = controlLabel(container);
        if (!labelInfo.text && containerLabel.text) labelInfo = containerLabel;
        const options = collectCustomOptions(container);
        const phoneGroup = phoneComposite(container, target);
        const compoundGroup = !phoneGroup ? selectCompound(container, target) : null;
        const isPhonePrefix = isCountryCodeOptions(options) || !!phoneGroup || isPhoneCountryCodeControl(container, target, labelInfo);
        if (isPhonePrefix) {
          const groupLabel = phoneGroup?.labelInfo || {};
          labelInfo = {
            ...labelInfo,
            text: "手机区号",
            raw: groupLabel.raw || labelInfo.raw || "手机号",
            source: "container",
          };
        } else if (compoundGroup) {
          labelInfo = {
            ...compoundGroup.labelInfo,
            text: `${compoundGroup.labelInfo.text}类型`,
            source: "container",
          };
        }
        addField({
          fieldId: `custom-${seq++}`,
          type: "custom-select",
          target,
          labelInfo,
          options,
          optionsComplete: false,
          value: target.value || cleanText(container).slice(0, 30),
          kind: "custom",
          container,
          adapter: isPhonePrefix ? "phone-country-code"
            : compoundGroup ? "compound-prefix"
            : /ant-select/.test(String(container.className || "")) ? "antd-select" : "element-select",
          slot: isPhonePrefix || compoundGroup ? "prefix" : "single",
          semanticHint: compoundGroup ? `${compoundGroup.labelInfo.text}类型` : "",
        });
        continue;
      }

      const targets = visibleTargets.length ? visibleTargets : [container];
      const sharedRepeat = targets.map(target => fieldContext(target).repeat).find(Boolean) || null;
      targets.forEach((target, index) => {
        let labelInfo = controlLabel(target);
        if (!labelInfo.text) {
          const containerLabel = controlLabel(container);
          if (containerLabel.text) labelInfo = containerLabel;
        }
        const slot = targets.length > 1 ? (index === 0 ? "start" : index === 1 ? "end" : String(index)) : "single";
        const context = fieldContext(target);
        const semanticHint = context.sectionKey === "education"
          ? (slot === "start" ? "教育开始时间" : slot === "end" ? "毕业时间" : "")
          : context.sectionKey === "internship"
            ? (slot === "start" ? "实习开始时间" : slot === "end" ? "实习结束时间" : "")
            : context.sectionKey === "work"
              ? (slot === "start" ? "工作开始时间" : slot === "end" ? "工作结束时间" : "")
              : context.sectionKey === "project"
                ? (slot === "start" ? "项目开始时间" : slot === "end" ? "项目结束时间" : "")
                : "";
        addField({
          fieldId: `custom-${seq++}`,
          type: "custom-date",
          target,
          labelInfo,
          value: target.value || "",
          kind: "custom",
          container,
          adapter: targets.length > 1 ? "date-range" : "custom-date",
          slot,
          dateMeta: dateMetaForCustom(container, target),
          semanticHint,
          contextOverride: sharedRepeat ? { repeat: fieldContext(target).repeat || sharedRepeat } : null,
        });
      });
    }

    // radio 分组（按 name；无 name 的各自成组）。
    const radioGroups = new Map();
    const radioKeys = new Map();
    const radioGroupIds = new Map();
    for (const el of controls) {
      if (processedControls.has(el) || el.type !== "radio") continue;
      const key = el.name || unnamedRadioGroupContainer(el) || `__radio_${seq++}`;
      radioKeys.set(el, key);
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key).push(el);
      if (!radioGroupIds.has(key)) radioGroupIds.set(key, typeof key === "string" ? key : `g${seq++}`);
    }

    for (const el of controls) {
      if (processedControls.has(el)) continue;
      if (el.type === "radio") {
        const key = radioKeys.get(el);
        const group = radioGroups.get(key) || [el];
        if (group[0] !== el) continue;
        const visible = group.filter(isVisible);
        if (!visible.length) continue;
        const first = visible[0];
        const labelInfo = controlLabel(first, true);
        addField({
          fieldId: `radio-${String(radioGroupIds.get(key) || `g${seq++}`).replace(/\W+/g, "_")}`,
          type: "radio",
          target: first,
          labelInfo,
          options: visible.map(optionText),
          optionsComplete: true,
          value: (visible.find(radio => radio.checked) || { value: "" }).value || "",
          kind: "radio",
          group: visible,
          adapter: "radio-group",
          required: visible.some(isRequired),
        });
        continue;
      }

      const classified = classifyControl(el);
      if (classified.skipped) {
        if (el.type === "hidden" || !isVisible(el)) continue;
        addField({
          fieldId: `input-${seq++}`,
          type: "text",
          target: el,
          labelInfo: controlLabel(el),
          value: el.value || "",
          skipped: true,
          kind: "none",
          adapter: "unsupported",
        });
        continue;
      }
      if (!isVisible(el)) continue;

      const options = String(el.tagName).toLowerCase() === "select"
        ? Array.from(el.options || []).map(option => option.text)
        : [];
      let labelInfo = controlLabel(el);
      const phoneGroup = phoneComposite(el, el);
      const isPhoneMain = !!phoneGroup && phoneGroup.phoneInput === el;
      const compoundGroup = !phoneGroup ? selectCompound(null, el) : null;
      const isCompoundMain = !!compoundGroup && compoundGroup.valueInput === el;
      if (isPhoneMain && !/手机|电话|phone|mobile|tel/i.test(labelInfo.text)) {
        labelInfo = { ...phoneGroup.labelInfo, text: phoneGroup.labelInfo.text || "手机号" };
      } else if (isCompoundMain) {
        labelInfo = compoundGroup.labelInfo;
      }
      if (isCountryCodeOptions(options)) labelInfo = { ...labelInfo, text: "手机区号" };
      addField({
        fieldId: `input-${seq++}`,
        type: classified.type,
        target: el,
        labelInfo,
        options,
        optionsComplete: String(el.tagName).toLowerCase() === "select",
        value: el.value || "",
        kind: "native",
        adapter: isPhoneMain ? "phone-number"
          : isCompoundMain ? "compound-value"
          : String(el.tagName).toLowerCase() === "select" ? "native-select" : "native-input",
        slot: isPhoneMain || isCompoundMain ? "main" : "single",
        dateMeta: classified.type === "date" ? dateMetaForNative(el) : null,
        semanticHint: isCompoundMain ? `${compoundGroup.labelInfo.text}账号` : "",
      });
    }

    let page = null;
    try {
      const url = String(root.URL || (root.location && root.location.href) || "");
      page = { title: root.title || "", url, host: url ? new URL(url).hostname : "" };
    } catch (_) {}
    const repeaters = scanRepeaters(root, fields);
    const formFingerprint = stableHash([
      ...fields.map(field => `${field.type}:${field.fingerprint}`),
      ...repeaters.map(item => `repeater:${item.fingerprint}:${item.currentCount}`),
    ].sort().join("|"));
    const documentFingerprint = stableHash(`${page?.url || ""}|${page?.title || ""}|${formFingerprint}`);
    const scanId = `scan-${Date.now().toString(36)}-${++scanSequence}`;
    fields.forEach(field => { field.scanId = scanId; });
    const fingerprintCounts = new Map();
    for (const field of fields) fingerprintCounts.set(field.fingerprint, (fingerprintCounts.get(field.fingerprint) || 0) + 1);
    for (const entry of registry.values()) entry.fingerprintMultiplicity = fingerprintCounts.get(entry.fingerprint) || 1;
    if (!scanOptions.dryRun) {
      elementRegistry = registry;
      scanSession = {
        scanId,
        documentFingerprint,
        formFingerprint,
        url: page?.url || "",
        dirty: false,
        formRoots: [...new Set([...registry.values()].map(entry => entry.el.closest && entry.el.closest("form")).filter(Boolean))],
      };
      installStructureObserver(root);
    }
    return { engineVersion: ENGINE_VERSION, fields, repeaters, page, scanId, documentFingerprint, formFingerprint };
  }

  function repeaterCandidates(root) {
    const selectors = "button, a, [role='button'], [data-add-kind], [class*='add'], [class*='Add']";
    return Array.from(root.querySelectorAll(selectors)).filter((candidate, index, list) => {
      if (!isVisible(candidate)) return false;
      const text = cleanText(candidate);
      const knownAddButton = /rfe-resume-form-pc-form-list-renderer-add-btn/.test(String(candidate.className || ""));
      if (!text || text.length > 40 || (!knownAddButton && !/(?:\+|新增|添加)/.test(text))) return false;
      if (!sectionDefinitionFromText(text)) return false;
      return list.indexOf(candidate) === index;
    });
  }

  function scanRepeaters(root, fields) {
    const registry = new Map();
    const repeaters = [];
    const seen = new Set();
    for (const action of repeaterCandidates(root)) {
      const definition = sectionDefinitionFromText(cleanText(action));
      if (!definition || seen.has(definition.arrayKey)) continue;
      seen.add(definition.arrayKey);
      const indexes = new Set(fields
        .filter(field => field.context?.repeat?.arrayKey === definition.arrayKey)
        .map(field => field.context.repeat.itemIndex));
      const hasSectionFields = fields.some(field => field.context?.sectionKey === definition.key);
      const currentCount = indexes.size || (hasSectionFields ? 1 : 0);
      const locators = locatorBundle(action);
      const fingerprint = stableHash(JSON.stringify({
        arrayKey: definition.arrayKey,
        text: normalizeCompare(cleanText(action)),
        attributes: semanticAttributes(action),
      }));
      const id = `repeater-${definition.arrayKey}`;
      const descriptor = {
        id,
        sectionKey: definition.key,
        arrayKey: definition.arrayKey,
        title: definition.title,
        currentCount,
        fingerprint,
        locators,
      };
      registry.set(id, { el: action, ...descriptor });
      repeaters.push(descriptor);
    }
    repeaterRegistry = registry;
    return repeaters;
  }

  // 区号下拉选项判断（过滤「请选择」等占位项）。
  function isCountryCodeOptions(options) {
    const list = (Array.isArray(options) ? options : [])
      .filter(option => String(option || "").trim() && !/^(请选择|请选择区号|选择|--|暂无)$/.test(String(option).trim()));
    return list.length >= 2 && list.every(option => /^\+?\d{1,4}$/.test(String(option).trim()));
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
      const el = resolveEntryTarget(entry);
      if (!el) continue;
      if (on) el.classList.add(HIGHLIGHT_CLASS);
      else el.classList.remove(HIGHLIGHT_CLASS);
    }
  }

  function reset(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (root) for (const entry of elementRegistry.values()) entry.el.classList.remove(HIGHLIGHT_CLASS);
    elementRegistry = new Map();
    repeaterRegistry = new Map();
    cancelSignal = null;
    scanSession = null;
    if (structureObserver) structureObserver.disconnect();
    structureObserver = null;
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

  // 逐字符模拟真实输入：keydown→beforeinput→input→keyup，提交时 change→blur。
  // 用于受控组件（如 React）——直接写 value 会被其内部状态回滚，必须走真实事件链。
  async function typeText(el, value, stepMs = 30) {
    const KeyEventCtor = typeof window.KeyboardEvent === "function" ? window.KeyboardEvent : Event;
    const typeChars = Array.from(String(value || ""));
    el.focus();
    el.select();
    if (typeof el.setRangeText === "function") {
      el.setRangeText("");
    } else {
      el.value = "";
    }
    for (const char of typeChars) {
      el.value += char;
      const opts = { key: char, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyEventCtor("keydown", opts));
      el.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyEventCtor("keyup", opts));
      await sleep(stepMs);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return el.value;
  }

  // 标准填充 → 回读校验 → 失败则打字重填 → 再次回读。
  async function fillTextWithRetry(entry, el, type, value) {
    const finalValue = type === "date" ? valueForNativeDate(el, value) : value;
    if (type === "date" && !finalValue) throw new Error("日期精度与页面控件不匹配，请手动选择");
    setNativeValue(el, finalValue);
    dispatchInput(el);
    if (verifyValue(el, type, finalValue)) return { ok: true, retried: false };
    await typeText(el, finalValue);
    if (!verifyValue(el, type, finalValue)) throw new Error("模拟输入后仍失败");
    return { ok: true, retried: true };
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
    return target; // 返回实际点击的选项，供回读校验
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

  function normalizeDateCompare(value) {
    const text = String(value || "").trim();
    if (/^\d{4}$/.test(text)) return text;
    const dateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (dateTime) {
      return `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}${dateTime[6] ? `:${dateTime[6]}` : ""}`;
    }
    if (/^\d{2}:\d{2}(?::\d{2})?$/.test(text)) return text;
    let match = text.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?$/);
    if (match) {
      const normalized = `${match[1]}-${String(match[2]).padStart(2, "0")}`;
      return match[3] ? `${normalized}-${String(match[3]).padStart(2, "0")}` : normalized;
    }
    match = text.match(/^(\d{1,2})[-/.](\d{4})$/);
    if (match) return `${match[2]}-${String(match[1]).padStart(2, "0")}`;
    return normalizeCompare(text);
  }

  function dateParts(value) {
    const normalized = normalizeDateCompare(value);
    let match = normalized.match(/^(\d{4})$/);
    if (match) return { normalized, precision: "year", year: Number(match[1]) };
    match = normalized.match(/^(\d{4})-(\d{2})$/);
    if (match) return { normalized, precision: "month", year: Number(match[1]), month: Number(match[2]) };
    match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return {
      normalized,
      precision: "day",
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
    match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (match) return { normalized, precision: "datetime", year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    if (/^\d{2}:\d{2}(?::\d{2})?$/.test(normalized)) return { normalized, precision: "time" };
    return null;
  }

  function valueForNativeDate(input, value) {
    const nativeType = String(input?.type || "date").toLowerCase();
    const parts = dateParts(value);
    if (!parts) return "";
    if (nativeType === "month") return ["month", "day", "datetime"].includes(parts.precision) ? parts.normalized.slice(0, 7) : "";
    if (nativeType === "date") return ["day", "datetime"].includes(parts.precision) ? parts.normalized.slice(0, 10) : "";
    if (nativeType === "datetime-local") return parts.precision === "datetime" ? parts.normalized : "";
    if (nativeType === "time") return parts.precision === "time" ? parts.normalized : "";
    return "";
  }

  // 自定义下拉兜底：写入内部 input 后，仅当容器展示值反映所选值才算成功。
  // 只校验我们写入的 input.value 是循环论证（受控组件可能未提交），必须看页面展示。
  function applyCustomInputFallback(container, value) {
    const input = container.querySelector("input");
    if (!input) throw new Error("下拉选项未找到");
    setNativeValue(input, value);
    dispatchInput(input);
    const displayed = normalizeCompare(cleanString(container.textContent));
    const expected = normalizeCompare(value);
    if (displayed && (displayed === expected || displayed.includes(expected) || expected.includes(displayed))) {
      return { ok: true, via: "input" };
    }
    throw new Error("下拉控件无法确认选择结果，请手动选择");
  }

  function customOptionRoots(container) {
    const doc = container.ownerDocument;
    const ids = new Set();
    for (const el of [container, ...container.querySelectorAll("[aria-controls], [aria-owns]")]) {
      const controls = `${el.getAttribute?.("aria-controls") || ""} ${el.getAttribute?.("aria-owns") || ""}`.trim();
      controls.split(/\s+/).filter(Boolean).forEach(id => ids.add(id));
    }
    const owned = [...ids].map(id => doc.getElementById(id)).filter(Boolean);
    if (owned.length) {
      const dropdowns = owned
        .map(node => node.closest?.(".ant-select-dropdown, .el-select-dropdown") || node.closest?.("[role='listbox']"))
        .filter(root => root && isVisible(root));
      return dropdowns.length ? [...new Set(dropdowns)] : owned.filter(isVisible);
    }
    const visible = Array.from(doc.querySelectorAll(".ant-select-dropdown, .el-select-dropdown, [role='listbox']")).filter(isVisible);
    return visible.length === 1 ? visible : [];
  }

  async function applyCustomSelect(entry, value) {
    const container = entry.container || entry.el;
    const selector = ".ant-select-item-option, .ant-select-item, .ant-select-dropdown-menu-item, .el-select-dropdown__item, [role='option']";
    const optionPriority = option => {
      let score = option.matches?.(".ant-select-item-option, .ant-select-dropdown-menu-item, .el-select-dropdown__item") ? 100 : 0;
      const rect = option.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) score += 20;
      return score;
    };
    const findTarget = () => {
      const options = customOptionRoots(container)
        .flatMap(root => Array.from(root.querySelectorAll(selector)))
        .filter(isVisible)
        .sort((a, b) => optionPriority(b) - optionPriority(a));
      return matchOption(options, value);
    };
    let target = findTarget();
    // 真实站点下拉选项通常在下拉展开后才挂载：点击展开并等待（最长 1.5s）。
    if (!target) {
      const opener = container.querySelector(".ant-select-selector, .el-input, [role='combobox']") || container;
      try {
        const input = container.querySelector("input");
        if (input && typeof input.focus === "function") input.focus();
        triggerAction(opener);
      } catch (_) {}
      const deadline = Date.now() + 1500;
      while (!target && Date.now() < deadline) {
        await sleep(120);
        target = findTarget();
      }
    }
    if (target) {
      scrollIntoView(target);
      triggerAction(target);
      // 回读：容器展示值或内部 input 值必须包含期望值，否则视为未生效。
      const displayed = normalizeCompare(cleanString(container.textContent));
      const expected = normalizeCompare(value);
      const input = container.querySelector("input");
      const inputValue = input ? normalizeCompare(input.value) : "";
      const reflected = (displayed && (displayed === expected || displayed.includes(expected) || expected.includes(displayed)))
        || (inputValue && (inputValue === expected || inputValue.includes(expected) || expected.includes(inputValue)));
      if (reflected) return { ok: true, via: "option" };
      // 点击未生效（受控组件未提交）：尝试输入兜底，兜底也失败则如实报错。
      return applyCustomInputFallback(container, value);
    }
    return applyCustomInputFallback(container, value);
  }

  function visiblePickerDropdown(doc, entry) {
    const linkedIds = new Set();
    for (const node of [entry?.el, entry?.container, ...Array.from(entry?.container?.querySelectorAll?.("[aria-controls], [aria-owns]") || [])]) {
      const ids = `${node?.getAttribute?.("aria-controls") || ""} ${node?.getAttribute?.("aria-owns") || ""}`.trim();
      ids.split(/\s+/).filter(Boolean).forEach(id => linkedIds.add(id));
    }
    const linked = [...linkedIds].map(id => doc.getElementById(id)).filter(Boolean)
      .map(node => node.closest?.(".ant-picker-dropdown, .el-picker-panel") || node)
      .filter(node => isVisible(node) && !node.classList?.contains("ant-picker-dropdown-hidden"));
    if (linked.length === 1) return linked[0];
    const visible = Array.from(doc.querySelectorAll(".ant-picker-dropdown, .el-picker-panel"))
      .filter(dropdown => !dropdown.classList.contains("ant-picker-dropdown-hidden") && isVisible(dropdown));
    return visible.length === 1 ? visible[0] : null;
  }

  function pickerMode(entry, dropdown) {
    const configured = entry?.dateMeta?.mode || "date";
    if (configured !== "date") return configured;
    if (dropdown?.querySelector(".ant-picker-year-panel, .el-year-table")) return "year";
    if (dropdown?.querySelector(".ant-picker-month-panel, .el-month-table")) return "month";
    const precisions = Array.from(dropdown?.querySelectorAll("td[title], [data-value], [data-date]") || [])
      .flatMap(cell => pickerDateTokens(pickerCellValue(cell)))
      .map(value => dateParts(value)?.precision)
      .filter(Boolean);
    if (precisions.length && precisions.every(precision => precision === "year")) return "year";
    if (precisions.length && precisions.every(precision => precision === "month")) return "month";
    return "date";
  }

  function pickerCellValue(cell) {
    return [
      cell.getAttribute?.("title"),
      cell.getAttribute?.("data-value"),
      cell.getAttribute?.("data-date"),
      cell.getAttribute?.("aria-label"),
    ].filter(Boolean).join(" ");
  }

  function pickerDateTokens(value) {
    const text = String(value || "");
    const tokens = text.match(/\d{4}(?:[-/.]\d{1,2}(?:[-/.]\d{1,2})?)?|\d{1,2}[-/.]\d{4}/g) || [];
    return tokens.length ? tokens : [text];
  }

  function findPickerCell(dropdown, expected, mode) {
    const candidates = Array.from(dropdown.querySelectorAll(
      "td[title], [data-value], [data-date], td[aria-label], .el-month-table td, .el-year-table td, .el-date-table td"
    )).filter(isVisible);
    const exact = candidates.find(cell => {
      return pickerDateTokens(pickerCellValue(cell)).some(value => {
        const normalized = normalizeDateCompare(value);
        if (mode === "year") return normalized.slice(0, 4) === expected;
        if (mode === "month") return normalized.slice(0, 7) === expected;
        return normalized === expected;
      });
    });
    if (exact) return exact;
    const header = cleanText(dropdown.querySelector(".ant-picker-header-view, .el-date-picker__header, .el-picker-panel__content"));
    const parts = dateParts(expected);
    if (!parts || !header.includes(String(parts.year))) return null;
    return candidates.find(cell => {
      if (cell.classList.contains("prev-month") || cell.classList.contains("next-month")) return false;
      const text = cleanText(cell.querySelector(".cell, .el-date-table-cell__text, .ant-picker-cell-inner") || cell);
      if (mode === "year") return Number(text.replace(/\D/g, "")) === parts.year;
      if (mode === "month") return Number(text.replace(/\D/g, "")) === parts.month;
      return Number(text.replace(/\D/g, "")) === parts.day;
    }) || null;
  }

  function pickerNavigation(dropdown, expected, mode) {
    const target = dateParts(expected);
    if (!target) return null;
    const values = Array.from(dropdown.querySelectorAll("td[title], [data-value], [data-date]"))
      .flatMap(cell => pickerDateTokens(pickerCellValue(cell)))
      .map(value => dateParts(value))
      .filter(Boolean);
    if (!values.length) return null;
    const key = parts => mode === "year"
      ? parts.year
      : mode === "month" ? parts.year * 12 + (parts.month || 1) : parts.year * 372 + (parts.month || 1) * 31 + (parts.day || 1);
    const targetKey = key(target);
    const keys = values.map(key);
    const backwards = targetKey < Math.min(...keys);
    const forwards = targetKey > Math.max(...keys);
    if (!backwards && !forwards) return null;
    const selector = mode === "date"
      ? (backwards
        ? ".ant-picker-header-prev-btn, .el-picker-panel__icon-btn.arrow-left"
        : ".ant-picker-header-next-btn, .el-picker-panel__icon-btn.arrow-right")
      : (backwards
        ? ".ant-picker-header-super-prev-btn, .el-picker-panel__icon-btn.d-arrow-left, .el-icon-d-arrow-left"
        : ".ant-picker-header-super-next-btn, .el-picker-panel__icon-btn.d-arrow-right, .el-icon-d-arrow-right");
    return dropdown.querySelector(selector);
  }

  function clickPickerConfirm(dropdown) {
    const buttons = Array.from(dropdown.querySelectorAll(".ant-picker-ok button, .el-picker-panel__footer button, button"));
    const confirm = buttons.find(button =>
      !button.disabled
      && isVisible(button)
      && /^(确定|确认|ok)$/i.test(cleanText(button))
    );
    if (confirm) triggerAction(confirm);
  }

  function dateValueMatches(actual, expected, mode) {
    const left = normalizeDateCompare(actual);
    const right = normalizeDateCompare(expected);
    if (!left || !right) return false;
    if (mode === "year") return left.slice(0, 4) === right.slice(0, 4);
    if (mode === "month") return left.slice(0, 7) === right.slice(0, 7);
    return left === right;
  }

  async function waitForStableDateValue(input, expected, mode, timeoutMs = 700) {
    const deadline = Date.now() + timeoutMs;
    let consecutive = 0;
    while (Date.now() < deadline) {
      await sleep(50);
      if (dateValueMatches(input.value, expected, mode)) {
        consecutive += 1;
        if (consecutive >= 3) return true;
      } else {
        consecutive = 0;
      }
    }
    return false;
  }

  async function applyPickerValue(entry, value) {
    const input = entry.el;
    const doc = input.ownerDocument;
    const parts = dateParts(value);
    if (!parts) throw new Error("日期格式无效，请手动选择");
    // 即使已有其他日期弹层，也必须先聚焦当前 slot，避免把结束月写到开始端。
    triggerAction(input);
    await sleep(80);
    let dropdown = visiblePickerDropdown(doc, entry);
    const deadline = Date.now() + 1000;
    while (!dropdown && Date.now() < deadline) {
      await sleep(80);
      dropdown = visiblePickerDropdown(doc, entry);
    }
    if (!dropdown) return null;
    const mode = pickerMode(entry, dropdown);
    if (mode === "date" && !["day", "datetime"].includes(parts.precision)) {
      throw new Error("页面要求具体日期，但简历仅包含年月，请手动选择");
    }
    if (mode === "datetime" && parts.precision !== "datetime") {
      throw new Error("页面要求日期和时间，简历信息精度不足，请手动选择");
    }
    if (mode === "time" && parts.precision !== "time") {
      throw new Error("页面要求具体时间，简历信息精度不足，请手动选择");
    }
    const expected = mode === "year"
      ? parts.normalized.slice(0, 4)
      : mode === "month" ? parts.normalized.slice(0, 7) : parts.normalized;
    for (let attempt = 0; attempt < 48; attempt++) {
      dropdown = visiblePickerDropdown(doc, entry);
      if (!dropdown) break;
      const cell = findPickerCell(dropdown, expected, mode);
      if (cell) {
        triggerAction(cell.querySelector(".ant-picker-cell-inner") || cell);
        await sleep(80);
        clickPickerConfirm(dropdown);
        if (await waitForStableDateValue(input, expected, mode)) return { ok: true, via: "picker" };
        return null;
      }
      const navigation = pickerNavigation(dropdown, expected, mode);
      if (!navigation) break;
      triggerAction(navigation);
      await sleep(100);
    }
    return null;
  }

  function verifyValue(el, type, value) {
    if (type === "radio" || type === "checkbox") return el.checked;
    if (type === "custom-date" || type === "date") {
      return normalizeDateCompare(el.value) === normalizeDateCompare(value);
    }
    const actual = normalizeCompare(el.value);
    const expected = normalizeCompare(value);
    return actual && (actual === expected || actual.includes(expected) || expected.includes(actual));
  }

  function entryFingerprint(entry, el) {
    return fieldFingerprintOf(el, entry.type, entry.slot, entry.kind === "radio");
  }

  function locatorCandidates(entry) {
    const doc = entry.el?.ownerDocument;
    if (!doc) return [];
    const candidates = new Set();
    for (const locator of entry.locators || []) {
      try {
        if (locator.kind === "id") {
          const found = doc.getElementById(locator.value);
          if (found) candidates.add(found);
        } else if (locator.kind === "name") {
          const selector = `${locator.tag || ""}[name="${escapeCss(locator.value)}"]`;
          doc.querySelectorAll(selector).forEach(found => candidates.add(found));
        } else if (locator.kind === "css") {
          doc.querySelectorAll(locator.value).forEach(found => candidates.add(found));
        }
      } catch (_) {}
    }
    return [...candidates].filter(candidate => candidate.isConnected);
  }

  function resolveRepeaterTarget(entry) {
    if (!entry) return null;
    if (entry.el?.isConnected) return entry.el;
    const matches = locatorCandidates(entry).filter(candidate => {
      const fingerprint = stableHash(JSON.stringify({
        arrayKey: entry.arrayKey,
        text: normalizeCompare(cleanText(candidate)),
        attributes: semanticAttributes(candidate),
      }));
      return fingerprint === entry.fingerprint;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  // 字段身份以语义指纹为准。缓存节点仍有效时优先使用；path 仅用于召回候选。
  function resolveEntryTarget(entry) {
    if (!entry) return null;
    if (entry.el?.isConnected && entryFingerprint(entry, entry.el) === entry.fingerprint) return entry.el;
    const hasStrongLocator = (entry.locators || []).some(locator => locator.kind === "id" || locator.kind === "name");
    if (entry.fingerprintMultiplicity > 1 && !hasStrongLocator) return null;
    const matches = locatorCandidates(entry).filter(candidate => entryFingerprint(entry, candidate) === entry.fingerprint);
    return matches.length === 1 ? matches[0] : null;
  }

  // radio 组按 name 重新解析（页面重渲染后组元素可能已替换）。
  function resolveRadioGroup(el, cachedGroup) {
    const name = el.getAttribute && el.getAttribute("name");
    if (name) {
      try {
        const scope = el.form || el.ownerDocument;
        const fresh = Array.from(scope.querySelectorAll(`input[type="radio"][name="${escapeCss(name)}"]`)).filter(isVisible);
        if (fresh.length) return fresh;
      } catch (_) {}
    }
    return (Array.isArray(cachedGroup) && cachedGroup.length ? cachedGroup : [el]).filter(item => item.isConnected);
  }

  function sessionError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function assertScanSession(options) {
    if (!scanSession) throw sessionError("扫描会话不存在，请重新扫描", "STALE_SCAN");
    if (options.scanId && options.scanId !== scanSession.scanId) {
      throw sessionError("扫描会话已过期，请重新扫描", "STALE_SCAN");
    }
    if (options.documentFingerprint && options.documentFingerprint !== scanSession.documentFingerprint) {
      throw sessionError("页面指纹已变化，请重新扫描", "STALE_DOCUMENT");
    }
    if (options.formFingerprint && options.formFingerprint !== scanSession.formFingerprint) {
      throw sessionError("表单指纹已变化，请重新扫描", "STALE_FORM");
    }
    const doc = elementRegistry.values().next().value?.el?.ownerDocument;
    const currentUrl = String(doc?.URL || "");
    if (scanSession.url && currentUrl && currentUrl !== scanSession.url) {
      throw sessionError("页面地址已变化，请重新扫描", "STALE_DOCUMENT");
    }
    if (scanSession.formRoots.length && scanSession.formRoots.every(form => !form.isConnected)) {
      throw sessionError("原表单已不在页面中，请重新扫描", "STALE_FORM");
    }
  }

  function preflightFills(list, options) {
    assertScanSession(options);
    const prepared = [];
    const targetOwners = new Map();
    for (const fill of list) {
      const entry = elementRegistry.get(fill.id);
      if (!entry) throw sessionError("字段未找到，请重新扫描", "STALE_FIELD");
      if (fill.fingerprint && fill.fingerprint !== entry.fingerprint) {
        throw sessionError("字段指纹不一致，请重新扫描", "STALE_FIELD");
      }
      const target = resolveEntryTarget(entry);
      if (!target) throw sessionError("无法唯一确认字段目标，请重新扫描", "STALE_TARGET");
      const owner = targetOwners.get(target);
      if (owner && owner !== fill.id) {
        throw sessionError("多个字段解析到同一目标，已停止填充", "DUPLICATE_TARGET");
      }
      targetOwners.set(target, fill.id);
      prepared.push({ fill, entry, target });
    }
    return prepared;
  }

  async function fillOne(fill, entry, resolvedTarget) {
    const value = String(fill.value ?? "").trim();
    if (!value) throw new Error("填充值为空");
    const type = fill.type || entry.type || "text";
    const el = resolveEntryTarget(entry);
    if (!el || (resolvedTarget && entryFingerprint(entry, el) !== entryFingerprint(entry, resolvedTarget))) {
      throw sessionError("字段目标在填充前发生变化，请重新扫描", "STALE_TARGET");
    }
    scrollIntoView(el);
    if (entry.kind === "radio") {
      const group = resolveRadioGroup(el, entry.group);
      const target = applyRadio(group, value);
      if (!target.checked) throw new Error("回读校验失败");
      return { ok: true };
    }
    if (entry.kind === "custom") {
      const container = (entry.container?.isConnected && entry.container)
        || el.closest?.(".ant-select, .el-select, .ant-picker, .el-date-editor")
        || el;
      const activeEntry = { ...entry, el, container };
      if (type === "custom-select") return applyCustomSelect(activeEntry, value);
      const pickerResult = await applyPickerValue(activeEntry, value);
      if (pickerResult) return pickerResult;
      throw new Error("日期组件未确认选择结果，请手动选择");
    }
    if (type === "checkbox") return applyCheckbox(el, value);
    if (type === "select") {
      const expected = normalizeCompare(value);
      const options = Array.from(el.options || []);
      const target = options.find(option => normalizeCompare(option.text) === expected)
        || options.find(option => normalizeCompare(option.text).includes(expected) || expected.includes(normalizeCompare(option.text)))
        || options.find(option => normalizeCompare(option.value) === expected);
      if (!target) throw new Error("选项未找到");
      setNativeValue(el, target.value);
      dispatchInput(el);
      if (String(el.value || "") !== String(target.value)) throw new Error("选项未找到");
      return { ok: true };
    }
    // 文本类（含 date）：标准填充后回读校验，失败则逐字符打字重填（受控组件兜底）。
    return fillTextWithRetry(entry, el, type, value);
  }

  async function apply(fills, options = {}) {
    const list = Array.isArray(fills) ? fills : [];
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 100;
    const results = [];
    cancelSignal = { cancelled: false };
    const signal = options.signal || cancelSignal;
    if (signal.cancelled) return results;
    const prepared = preflightFills(list, options);
    for (let index = 0; index < prepared.length; index++) {
      if (signal.cancelled) break;
      const { fill, entry, target } = prepared[index];
      const item = { id: fill.id, ok: false };
      try {
        Object.assign(item, await fillOne(fill, entry, target));
        item.retried = item.retried || false;
        const verifiedTarget = resolveEntryTarget(entry);
        const adapterVerified = ["antd-select", "element-select", "phone-country-code", "compound-prefix"].includes(entry.adapter);
        if (!verifiedTarget && !adapterVerified) {
          throw sessionError("填充后无法确认字段目标", "STALE_TARGET");
        }
        item.ok = true;
        item.resolvedFingerprint = verifiedTarget ? entryFingerprint(entry, verifiedTarget) : entry.fingerprint;
        item.verification = "adapter";
        markElementProcessed(verifiedTarget || target);
      } catch (error) {
        item.error = error.message || String(error);
        item.errorCode = error.code || "FILL_FAILED";
      }
      results.push(item);
      if (typeof options.onProgress === "function") {
        options.onProgress({ index: index + 1, total: prepared.length, id: fill.id, ok: item.ok, error: item.error, errorCode: item.errorCode });
      }
      if (index < prepared.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    return results;
  }

  function triggerAction(action) {
    const view = action.ownerDocument?.defaultView;
    const MouseEventCtor = view?.MouseEvent || (typeof MouseEvent !== "undefined" ? MouseEvent : null);
    if (MouseEventCtor) {
      action.dispatchEvent(new MouseEventCtor("mousedown", { bubbles: true, cancelable: true, view }));
      action.dispatchEvent(new MouseEventCtor("mouseup", { bubbles: true, cancelable: true, view }));
    }
    action.click();
  }

  async function prepareRepeaters(plans, options = {}) {
    const requested = Array.isArray(plans) ? plans.slice(0, 12) : [];
    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 100;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1800;
    const results = [];
    let latest = null;
    assertScanSession(options);
    for (const plan of requested) {
      const initial = repeaterRegistry.get(plan.id);
      const item = { id: plan.id, arrayKey: initial?.arrayKey || "", ok: false, added: 0 };
      try {
        if (!initial) throw sessionError("新增区块已失效，请重新扫描", "STALE_REPEATER");
        if (plan.fingerprint && plan.fingerprint !== initial.fingerprint) {
          throw sessionError("新增区块指纹不一致，请重新扫描", "STALE_REPEATER");
        }
        const targetCount = Math.max(0, Math.min(10, Number(plan.targetCount) || 0));
        latest = scan(initial.el.ownerDocument);
        let descriptor = latest.repeaters.find(entry => entry.arrayKey === initial.arrayKey);
        let currentCount = descriptor?.currentCount || 0;
        while (currentCount < targetCount) {
          const registryEntry = descriptor ? repeaterRegistry.get(descriptor.id) : null;
          const action = resolveRepeaterTarget(registryEntry);
          if (!action) throw sessionError("无法确认新增区块按钮，请重新扫描", "STALE_REPEATER");
          const before = currentCount;
          triggerAction(action);
          const deadline = Date.now() + timeoutMs;
          do {
            if (delayMs > 0) await sleep(Math.min(delayMs, 120));
            latest = scan(action.ownerDocument);
            descriptor = latest.repeaters.find(entry => entry.arrayKey === initial.arrayKey);
            currentCount = descriptor?.currentCount || 0;
          } while (currentCount <= before && Date.now() < deadline);
          if (currentCount <= before) {
            throw sessionError(`「${initial.title}」点击后未检测到新增内容，已停止`, "REPEATER_NOT_ADDED");
          }
          item.added += currentCount - before;
        }
        item.ok = true;
        item.currentCount = currentCount;
      } catch (error) {
        item.error = error.message || String(error);
        item.errorCode = error.code || "PREPARE_FAILED";
      }
      results.push(item);
      if (!item.ok) break;
    }
    if (!latest) {
      const doc = repeaterRegistry.values().next().value?.el?.ownerDocument
        || elementRegistry.values().next().value?.el?.ownerDocument;
      latest = scan(doc);
    }
    return { ...latest, results };
  }

  // —— 点击字段填充（P1 任务5） ——
  // 单字段按 fieldId 填充：复用 apply 的会话/指纹/重复目标预检。
  async function fillFieldById(fill, options = {}) {
    const id = String(fill?.id || "");
    const entry = elementRegistry.get(id);
    if (!entry) throw sessionError("字段未找到，请重新扫描", "STALE_FIELD");
    const results = await apply(
      [{ id, value: String(fill?.value ?? ""), type: entry.type, fingerprint: entry.fingerprint }],
      { ...options, delayMs: 0 }
    );
    return results[0] || { id, ok: false, error: "填充失败", errorCode: "FILL_FAILED" };
  }

  let pickSeq = 0;
  let pickController = null;

  function findPickableControl(target) {
    if (!(target instanceof HTMLElement)) return null;
    if (target.closest && target.closest("#hunter-pick-overlay")) return null;
    const selector = 'input:not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, .ant-select, .el-select, .ant-picker, .el-date-editor';
    return target.closest ? target.closest(selector) || null : null;
  }

  function logicalControlFor(control) {
    const custom = control.closest && control.closest(".ant-select, .el-select, .ant-picker, .el-date-editor");
    if (custom) {
      const inner = custom.querySelector('input:not([type="hidden"]), textarea, select');
      return { el: inner || custom, container: custom };
    }
    if (control.matches && control.matches('input:not([type="hidden"]), textarea, select')) {
      return { el: control, container: null };
    }
    const inner = control.querySelector && control.querySelector('input:not([type="hidden"]), textarea, select');
    if (inner) return { el: inner, container: null };
    return null;
  }

  // 把点击的控件按扫描同款逻辑建成临时 entry 后走 fillOne（含回读校验）。
  async function fillPickedControl(control, value) {
    const logical = logicalControlFor(control);
    if (!logical) throw sessionError("请点击可填写的输入框或下拉框", "NOT_FILLABLE");
    const { el, container } = logical;
    const classified = classifyControl(el);
    const isCustom = !!container || ["custom-select", "custom-date"].includes(classified.type);
    const kind = classified.type === "radio" ? "radio" : (isCustom ? "custom" : "native");
    const entry = {
      id: `pick-${Date.now().toString(36)}-${pickSeq++}`,
      kind,
      el,
      container,
      group: null,
      type: classified.type,
      adapter: isCustom
        ? (classified.type === "custom-select"
          ? (container && /ant-select/.test(String(container.className || "")) ? "antd-select" : "element-select")
          : "custom-date")
        : (String(el.tagName).toLowerCase() === "select" ? "native-select" : "native-input"),
      fingerprint: fieldFingerprintOf(el, classified.type, "single", classified.type === "radio"),
      label: (controlLabel(el).text || el.getAttribute("placeholder") || "").trim() || "已选字段",
      path: uniquePath(el),
      locators: locatorBundle(el),
      slot: "single",
      dateMeta: classified.type === "date" ? dateMetaForNative(el) : null,
    };
    const result = await fillOne({ id: entry.id, value, type: entry.type, fingerprint: entry.fingerprint }, entry, el);
    markElementProcessed(container || el);
    return result;
  }

  // 拾取态：高亮可填控件；点击可填控件即填充；点击非可填区域给出提示且保持拾取；Esc 取消。
  function pickFill(value) {
    return new Promise(resolve => {
      if (pickController) {
        const old = pickController;
        old.cleanup();
        pickController = null;
        old.resolve({ ok: false, cancelled: true, error: "已有进行中的点击填充" });
      }
      let controller = null;
      let highlight = null;
      const overlay = document.createElement("div");
      overlay.id = "hunter-pick-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483646;pointer-events:none;font:14px/1.6 sans-serif;color:#2563eb;display:flex;align-items:flex-start;justify-content:center;padding-top:72px;text-align:center;";
      (document.body || document.documentElement).appendChild(overlay);

      const setHighlight = el => {
        if (highlight === el) return;
        if (highlight && highlight.style) highlight.style.outline = "";
        highlight = el;
        if (el && el.style) el.style.outline = "2px solid #2563eb";
      };

      const hintTimer = { id: null };
      const showHint = text => {
        overlay.textContent = text;
        if (hintTimer.id) clearTimeout(hintTimer.id);
        hintTimer.id = setTimeout(() => { overlay.textContent = ""; }, 1200);
      };

      const finish = () => {
        if (pickController !== controller) return;
        pickController = null;
        document.removeEventListener("mousemove", onMouseMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown, true);
        setHighlight(null);
        overlay.remove();
      };

      const onMouseMove = event => setHighlight(findPickableControl(event.target));

      const onClick = async event => {
        const control = findPickableControl(event.target);
        if (!control) {
          showHint("请点击输入框/下拉框（Esc 取消）");
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        finish();
        try {
          const r = await fillPickedControl(control, value);
          resolve({ ...r, value: r.actualValue ?? value });
        } catch (error) {
          resolve({ ok: false, error: error.message || String(error), errorCode: error.code || "PICK_FAILED" });
        }
      };

      const onKeyDown = event => {
        if (event.key === "Escape" || event.key === "Esc") {
          event.preventDefault();
          finish();
          resolve({ ok: false, cancelled: true });
        }
      };

      controller = { cleanup: finish, resolve };
      pickController = controller;
      overlay.textContent = "点击要填入的位置（Esc 取消）";
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
    });
  }

  // —— 增量续填（P1 任务6） ——
  let newFieldsWatch = null;
  function startNewFieldsWatch(options = {}) {
    stopNewFieldsWatch();
    const threshold = Number.isFinite(options.threshold) ? Math.max(1, options.threshold) : 4;
    const onFound = typeof options.onFound === "function" ? options.onFound : null;
    const roots = scanSession?.formRoots?.length ? scanSession.formRoots : [document.body || document.documentElement];
    let timer = null;
    const check = () => {
      timer = null;
      if (!onFound) return;
      try {
        const result = scan(document, { onlyUnprocessed: true, dryRun: true });
        const count = result.fields.filter(field => !field.skipped && !String(field.value ?? "").trim()).length;
        if (count >= threshold) {
          stopNewFieldsWatch();
          onFound(count);
        }
      } catch (_) {}
    };
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(check, 120);
    });
    roots.forEach(root => {
      if (root && root.isConnected) {
        try { observer.observe(root, { subtree: true, childList: true, attributes: false, characterData: false }); } catch (_) {}
      }
    });
    newFieldsWatch = {
      observer,
      stop: () => {
        if (timer) clearTimeout(timer);
        try { observer.disconnect(); } catch (_) {}
      },
    };
  }
  function stopNewFieldsWatch() {
    if (newFieldsWatch) {
      newFieldsWatch.stop();
      newFieldsWatch = null;
    }
  }

  // —— 消息监听（真实环境） ——
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        if (message.type === "SMART_FILL_SCAN") {
          const result = scan(undefined, { onlyUnprocessed: !!message.onlyNew });
          sendResponse({ ok: true, ...result });
        } else if (message.type === "SMART_FILL_FILL_FIELD") {
          (async () => {
            try {
              const result = await fillFieldById(message, {
                scanId: message.scanId,
                documentFingerprint: message.documentFingerprint,
                formFingerprint: message.formFingerprint,
              });
              sendResponse({ ok: true, ...result });
            } catch (error) {
              sendResponse({ ok: false, error: error.message || String(error), errorCode: error.code || "FILL_FAILED" });
            }
          })();
          return true;
        } else if (message.type === "SMART_FILL_PICK_START") {
          (async () => {
            try {
              const value = String(message.value ?? "").trim();
              if (!value) throw new Error("填充值为空");
              const requestId = String(message.requestId || "");
              sendResponse({ ok: true });
              const result = await pickFill(value);
              if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ type: "SMART_FILL_PICK_RESULT", requestId, ...result }).catch(() => {});
              }
            } catch (error) {
              sendResponse({ ok: false, error: error.message || String(error), errorCode: error.code || "PICK_FAILED" });
            }
          })();
          return true;
        } else if (message.type === "SMART_FILL_APPLY") {
          (async () => {
            try {
              const results = await apply(message.fills || [], {
                delayMs: 100,
                scanId: message.scanId,
                documentFingerprint: message.documentFingerprint,
                formFingerprint: message.formFingerprint,
                onProgress: item => {
                  try { chrome.runtime.sendMessage({ type: "SMART_FILL_PROGRESS", ...item }).catch(() => {}); } catch (_) {}
                },
              });
              sendResponse({ ok: true, results });
            } catch (error) {
              sendResponse({ ok: false, error: error.message || String(error), errorCode: error.code || "FILL_FAILED", results: [] });
            }
          })();
          return true;
        } else if (message.type === "SMART_FILL_PREPARE") {
          (async () => {
            try {
              const result = await prepareRepeaters(message.plans || [], {
                delayMs: 100,
                timeoutMs: 1800,
                scanId: message.scanId,
                documentFingerprint: message.documentFingerprint,
                formFingerprint: message.formFingerprint,
              });
              sendResponse({ ok: result.results.every(item => item.ok), ...result });
            } catch (error) {
              sendResponse({ ok: false, error: error.message || String(error), errorCode: error.code || "PREPARE_FAILED", results: [] });
            }
          })();
          return true;
        } else if (message.type === "SMART_FILL_WATCH_START") {
          try {
            startNewFieldsWatch({
              threshold: Number.isFinite(message.threshold) ? message.threshold : 4,
              onFound: count => {
                try {
                  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage({ type: "SMART_FILL_NEW_FIELDS", count, scanId: scanSession?.scanId }).catch(() => {});
                  }
                } catch (_) {}
              },
            });
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, error: error.message || String(error) });
          }
          return true;
        } else if (message.type === "SMART_FILL_WATCH_STOP") {
          stopNewFieldsWatch();
          sendResponse({ ok: true });
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
    globalThis.__hunterFill = { scan, apply, prepareRepeaters, highlight, reset, fillField: fillFieldById, pickFill, startWatch: startNewFieldsWatch, stopWatch: stopNewFieldsWatch };
  }
})();
