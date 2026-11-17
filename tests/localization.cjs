'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const dictionary=JSON.parse(fs.readFileSync(path.join(root,'dictionary.json'),'utf8'));
const {buildInjectScript}=require('../patch.js');
const injected=buildInjectScript(dictionary);
class TextNode {
  constructor(value) { this.nodeType=3; this.value=value; this.writes=0; }
  get textContent() { return this.value; }
  set textContent(value) { this.writes++; this.value=value; }
}
class Element {
  constructor(tag, children=[], attributes={}) {
    this.nodeType=1; this.tagName=tag.toUpperCase(); this.childNodes=children; this.attributes={...attributes};
    for(const child of children) child.parentElement=this;
  }
  get textContent() { return this.childNodes.map(node=>node.textContent).join(''); }
  matches(selector) {
    return selector.split(',').some(part => {
      part=part.trim();
      if(/^(?:[a-z]+)?(?:\.[a-z0-9_-]+)+$/i.test(part)) { const chunks=part.split('.');return (!chunks[0]||this.tagName===chunks[0].toUpperCase())&&chunks.slice(1).every(name=>(this.attributes.class||'').split(' ').includes(name)); }
      if(part==='[title]') return this.hasAttribute('title');
      if(part==='span[data-screenshot-volatile]') return this.tagName==='SPAN' && this.hasAttribute('data-screenshot-volatile');
      if(part.startsWith('[data-testid=')) return part.includes('"'+this.attributes['data-testid']+'"');
      if(part.startsWith('[contenteditable]')) return this.attributes.contenteditable && this.attributes.contenteditable!=='false';
      if (/^[a-z]+$/i.test(part)) return this.tagName===part.toUpperCase();
      return part.startsWith('.') && (this.attributes.class||'').split(' ').includes(part.slice(1));
    });
  }
  querySelectorAll(selector) {
    const result=[];
    function visit(element) {for(const child of element.childNodes) if(child.nodeType===1) {if(child.matches(selector)) result.push(child);visit(child);}}
    visit(this);return result;
  }
  hasAttribute(name) { return Object.hasOwn(this.attributes,name); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name,value) { this.attributes[name]=value; }
}
function scenario(hostname) {
  const settings=new TextNode('Settings');
  const identical=new TextNode('Google Drive');
  const userText=new TextNode('Settings');
  const agentText=new TextNode('Run');
  const codeText=new TextNode('Run');
  const greeting=new TextNode('Welcome back, Test User. Where should we pick up?');
  const alternateGreeting=new TextNode("Good to see you, Test User. What's next?");
  const selector=new Element('button',[],{'aria-label':'Select project, current: No Project'});
  const projectDescription=new TextNode('Manage workspace resources, agent settings, and permissions.');
  const planPrefix=new TextNode('Your Plan: ');
  const planName=new TextNode('Antigravity Starter Quota');
  const planCombined=new TextNode('Your Plan: Antigravity Starter Quota');
  const eligibility=new TextNode('This account is ineligible for higher rate limits through a Google AI plan at this time.');
  const pluginTitle=new TextNode('Science');
  const highlightedIntro=new Element('div',[new Element('span',[new TextNode('Read, draft,')]),new TextNode(' and edit docs.')],{class:'text-sm text-muted-foreground truncate'});
  const pluginCard=new Element('div',[new Element('div',[pluginTitle],{class:'font-medium text-foreground truncate'}),highlightedIntro],{'data-testid':'customization-card','data-card-name':'Science'});
  const emptyState=new Element('p',[new TextNode('No '),new TextNode('automations'),new TextNode(' yet')]);
  const emptyContainer=new Element('div',[emptyState],{'data-testid':'sidecar-list-empty'});
  const automationName=new TextNode('Settings');
  const automationNotice=new Element('span',[new TextNode('This '),new TextNode('project'),new TextNode(' is managed by the'),new TextNode(' '),new Element('strong',[automationName]),new TextNode(' automation and can only be deleted by deleting that automation.')]);
  const creationName=new TextNode('Settings');
  const globalPermissions=new Element('span',[new TextNode('Global Permissions')],{class:'text-link hover:underline cursor-pointer font-medium'});
  const learnMore=new Element('a',[new TextNode('Learn more')],{href:'https://example.com/permissions'});
  function creationChildren() { return [new TextNode('This project was created for'),new TextNode(' '),new TextNode('the '),new Element('strong',[creationName]),new TextNode(' '),new TextNode('automation. '),new TextNode('Also includes'),new TextNode(' '),globalPermissions,new TextNode(' '),new TextNode('when working '),new TextNode('in this project'),new TextNode('.'),new TextNode(' '),learnMore,new TextNode('.')]; }
  const creationNotice=new Element('span',creationChildren());
  const lateCreationNotice=new Element('span',[]);
  const advancedDescription=new TextNode('Modify permissions for file and terminal tools.');
  const feedbackType=new TextNode('Feedback Type');
  const customizationsEmpty=new TextNode('There are no customizations enabled.');
  const quotaEmpty=new TextNode('No quota information available.');
  const modelNotice=new TextNode('Notice');
  const modelUnavailable=new TextNode('Unavailable');
  const viewPlans=new TextNode('View plans');
  const noticeFixtures={"Notice": "提示", "Unavailable": "不可用", "Your quota for this model is running low.": "此模型的剩余配额较低。", "To continue using this model now, enable AI Credit overages.": "如需立即继续使用此模型，请启用 AI 积分超额使用。", "Too many requests, please try again in a bit!": "请求过于频繁，请稍后重试！", "No Model Selected": "未选择模型", "Select Model": "选择模型", "Edit Model": "编辑模型", "Add Model": "添加模型", "Custom models are only supported on Linux machines.": "自定义模型仅支持在 Linux 设备上使用。", "Loading models...": "正在加载模型……", "No models available": "暂无可用模型", "Best of N Models": "从 N 个模型中择优", "View plans": "查看方案", "See plans": "查看方案", "Sonnet 5.5 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 18, 2026.": "Sonnet 5.5 现已向付费 Pro 和 Ultra 方案用户开放。从 2026 年 11 月 18 日起，你当前的方案将不再提供第三方模型访问权限。", "Opus 5.5 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 18, 2026.": "Opus 5.5 现已向付费 Pro 和 Ultra 方案用户开放。从 2026 年 11 月 18 日起，你当前的方案将不再提供第三方模型访问权限。", "GPT-OSS will be removed from Antigravity on November 18, 2026.": "GPT-OSS 将于 2026 年 11 月 18 日从 Antigravity 中移除。", "Gemini 4 Carbon is currently available to Ultra plan subscribers.": "Gemini 4 Carbon 目前向 Ultra 方案订阅用户开放。", "Gemini 4 Argon is currently available to Ultra and paid Pro plan subscribers.": "Gemini 4 Argon 目前向 Ultra 和付费 Pro 方案订阅用户开放。", "Gemini 4 Hydrogen is currently available to paid Pro and Ultra subscribers.": "Gemini 4 Hydrogen 目前向付费 Pro 和 Ultra 订阅用户开放。"};
  Object.assign(noticeFixtures,{"Sonnet 6.1 is now available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on January 2, 2027.": "Sonnet 6.1 现已向付费 Pro 和 Ultra 方案用户开放。从 2027 年 1 月 2 日起，你当前的方案将不再提供第三方模型访问权限。", "GPT-OSS Next will be removed from Antigravity on December 31, 2028.": "GPT-OSS Next 将于 2028 年 12 月 31 日从 Antigravity 中移除。", "Gemini 5 Carbon is currently available to Ultra plan subscribers.": "Gemini 5 Carbon 目前向 Ultra 方案订阅用户开放。", "Your quota for Gemini Test will reset on February 3, 2029. Switch to another available model to continue.": "Gemini Test 的配额将于 2029 年 2 月 3 日重置。请切换到其他可用模型以继续。", "Your plan's baseline quota will refresh on March 4, 2030.": "你的方案基础配额将于 2030 年 3 月 4 日刷新。"});
  Object.assign(noticeFixtures,{"low": "低", "medium": "中", "GPT-OSS 120B (Medium)": "GPT-OSS 120B（中）", "Gemini 3.8 Flash (Low)": "Gemini 3.8 Flash（低）", "Claude Sonnet 4.6 (Thinking)": "Claude Sonnet 4.6（思考）", "Gemini 3.8 Flash High": "Gemini 3.8 Flash 高"});
  Object.assign(noticeFixtures,{"Your This Computer setting": "你的本机设置", "Your Remote setting": "你的远程环境设置", "Project setting": "项目设置", "Workspace setting": "工作区设置", "Remote Permissions": "远程权限", "Only this conversation uses this preset.": "仅此会话使用此预设。", "This Conversation": "此会话", "Use Global Settings": "使用全局设置", "Failed to copy:": "复制失败：", "Auto": "自动", "Default needs the terminal sandbox, which isn't available on this host.": "默认模式需要终端沙盒，此设备暂不支持。", "Auto needs the terminal sandbox, which isn't available on this host.": "自动模式需要终端沙盒，此设备暂不支持。", "This project overrides your global permission settings.": "此项目的设置会覆盖你的全局权限设置。", "This workspace overrides your global permission settings.": "此工作区的设置会覆盖你的全局权限设置。", "Enter Queues after the turn": "Enter 等待当前轮次结束后发送", "Alt+Enter Sends immediately": "Alt+Enter 立即发送", "Alt+Enter On empty prompt, sends next in queue": "Alt+Enter 输入为空时，发送队列中的下一条消息", "Enter Sends immediately": "Enter 立即发送", "Alt+Enter Queues after the turn": "Alt+Enter 等待当前轮次结束后发送"});
  Object.assign(noticeFixtures,{"Changes to third-party model access": "第三方模型访问权限变更", "Opus 5.5 and Sonnet 5.5 are available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on November 18, 2026.": "Opus 5.5 和 Sonnet 5.5 现已向付费 Pro 和 Ultra 方案用户开放。从 2026 年 11 月 18 日起，你当前的方案将不再提供第三方模型访问权限。", "Opus 6.2 and Sonnet 6.3 are available on paid Pro and Ultra plans. Third-party model access will no longer be available on your current plan starting on February 19, 2028.": "Opus 6.2 和 Sonnet 6.3 现已向付费 Pro 和 Ultra 方案用户开放。从 2028 年 2 月 19 日起，你当前的方案将不再提供第三方模型访问权限。"});
  Object.assign(noticeFixtures,{
    "Google AI Plus users receive the minimum base limits on Antigravity. You can upgrade to Google AI Pro or above to receive higher rate limits.": "Google AI Plus 用户在 Antigravity 中享有最低基础限额。升级至 Google AI Pro 或更高方案可获得更高的请求限额。",
    "Choose whether to be notified when the agent needs your attention or completes a task.": "选择是否在智能体需要你处理或完成任务时收到通知。"
  });
  Object.assign(noticeFixtures,{"Within each group, models share a weekly limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. Your weekly limit is tied directly to your individual tier.": "每组内的模型共享每周限额。配额消耗与 Token 成本成比例，因此较短的任务或成本更低的模型可让配额使用更久。你的每周限额直接取决于你个人的订阅等级。", "Models within this group:": "此组内的模型：", "Yes, allow": "是，允许", "Yes, allow this time": "是，仅允许这一次", "Yes, allow this download": "是，允许此次下载", "Yes, and always allow in this conversation": "是，并在此会话中始终允许", "Yes, save rule in this conversation": "是，在此会话中保存规则", "Yes, save rule globally": "是，全局保存规则", "Yes, and always allow": "是，并始终允许", "(tell the agent what to do instead)": "（告诉智能体应改做什么）", "Allow the browser agent to download a file?": "允许浏览器智能体下载文件吗？", "Allow read access to this path?": "允许读取此路径吗？", "Allow write access to this path?": "允许写入此路径吗？", "Allow reading this URL?": "允许读取此网址吗？", "Allow executing actions on this URL?": "允许在此网址上执行操作吗？", "Allow browser downloads from this site?": "允许从此网站通过浏览器下载吗？", "Allow running this command?": "允许运行此命令吗？", "Allow running this command outside the sandbox?": "允许在沙盒外运行此命令吗？", "Allow using this MCP tool?": "允许使用此 MCP 工具吗？", "Allow a one-time administrator (UAC) elevation?": "允许此次提升为管理员权限（UAC）吗？", "Allow access to this resource?": "允许访问此资源吗？", "Save rule to always allow read access to this path?": "保存规则以始终允许读取此路径吗？", "Save rule to always allow write access to this path?": "保存规则以始终允许写入此路径吗？", "Save rule to always allow reading this URL?": "保存规则以始终允许读取此网址吗？", "Save rule to always allow executing actions on this URL?": "保存规则以始终允许在此网址上执行操作吗？", "Save rule to always allow browser downloads from this site?": "保存规则以始终允许从此网站通过浏览器下载吗？", "Save rule to always allow running this command?": "保存规则以始终允许运行此命令吗？", "Save rule to always allow running this command outside the sandbox?": "保存规则以始终允许在沙盒外运行此命令吗？", "Save rule to always allow using this MCP tool?": "保存规则以始终允许使用此 MCP 工具吗？", "Save rule to always allow a one-time administrator (UAC) elevation?": "保存规则以始终允许单次管理员权限提升（UAC）吗？", "Save rule to always allow access to this resource?": "保存规则以始终允许访问此资源吗？", "Confirm the command is safe to run outside of the sandbox with full network and disk access.": "请确认此命令可安全地在沙盒外运行，并拥有完整的网络和磁盘访问权限。", "Requesting a one-time administrator (UAC) elevation": "正在请求此次提升为管理员权限（UAC）", "From": "来源", "Redirected from": "重定向来源", "Models within this group: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B": "此组内的模型：Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B", "Models within this group: Gemini 3.8 Flash": "此组内的模型：Gemini 3.8 Flash", "Models within this group: Gemini 5 Flash, Claude Opus 6": "此组内的模型：Gemini 5 Flash, Claude Opus 6", "You have used some of your weekly limit, it will fully refresh in 6 days, 15 hours.": "你已使用部分每周配额，将在 6 天，15 小时后全部恢复。", "You have used some of your weekly limit, it will fully refresh in 1 day, 1 hour, 2 minutes and 3 seconds.": "你已使用部分每周配额，将在 1 天，1 小时，2 分钟，3 秒后全部恢复。", "Allow list files in antigravity references?": "允许列出 antigravity references 中的文件吗？", "Yes, and always allow 'Settings' in this conversation": "是，并在此会话中始终允许“Settings”", "Yes, allow downloads from example.com for this run": "是，仅本次运行允许从 example.com 下载", "Yes, save rule for 'D:/docs/*.txt' globally": "是，全局保存“D:/docs/*.txt”的规则"});
  Object.assign(noticeFixtures,{
    'Allow search for codex references?':'允许搜索 codex references 吗？',
    'Allow search for antigravity references?':'允许搜索 antigravity references 吗？',
    'Save rule to always allow search for codex references?':'保存规则以始终允许搜索 codex references 吗？',
    'Allow search for Codex References 2.0 (local)/中文目录?':'允许搜索 Codex References 2.0 (local)/中文目录 吗？'
  });
  const hiddenFixtures={
    'For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.':'付费 Pro 方案的 Argon 配额单独计算。Ultra 方案提供更高的 Argon 配额，并将其包含在更大的 Gemini 配额池中。',
    'For paid Pro plans, Carbon quota is separate. Higher Carbon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.':'付费 Pro 方案的 Carbon 配额单独计算。Ultra 方案提供更高的 Carbon 配额，并将其包含在更大的 Gemini 配额池中。',
    'Argon that may offload routine steps to Hydrogen. Same Argon-level quality, fewer tokens used.':'Argon 可将常规步骤交给 Hydrogen，在保持 Argon 级别质量的同时，减少 Token 用量。',
    'Where the agent runs, current: This Computer':'智能体运行位置，当前：本机',
    'Where the agent runs, current: Remote':'智能体运行位置，当前：远程环境',
    'Where the agent runs, current: Example_Host':'智能体运行位置，当前：Example_Host',
    'Within each group, models share a weekly limit and a 5-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 5-hour limit is to smooth out aggregate demand and to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.':'每组内的模型共享每周限额和 5 小时限额。配额按 Token 成本比例消耗，因此较短的任务或成本更低的模型可让配额使用更久。5 小时限额用于平衡整体需求，并向所有用户公平分配全球服务容量；每周限额则直接取决于你个人的方案等级。',
    'Within each group, models share a weekly limit and a 12-hour limit. Quota is consumed proportionally to the cost of the tokens. Thus, limits will last longer with shorter tasks or using more cost-effective models. The 12-hour limit is to smooth out aggregate demand and to fairly distribute global capacity across all users, while your weekly limit is tied directly to your individual tier.':'每组内的模型共享每周限额和 12 小时限额。配额按 Token 成本比例消耗，因此较短的任务或成本更低的模型可让配额使用更久。12 小时限额用于平衡整体需求，并向所有用户公平分配全球服务容量；每周限额则直接取决于你个人的方案等级。',
    'Introducing Gemini 4 Hydrogen':'全新推出 Gemini 4 Hydrogen',
    'Introducing Gemini 4.5 Carbon':'全新推出 Gemini 4.5 Carbon',
    'Our daily driver for rapid coding and dependable agentic execution!':'快速编程、可靠执行智能体任务的日常主力模型！',
    'Introducing ExamplePlugin':'Introducing ExamplePlugin',
    'Gemini 4 Argon Weekly Limit':'Gemini 4 Argon 每周限额',
    'Gemini 4.5 Carbon Daily Limit':'Gemini 4.5 Carbon 每日限额',
    'Gemini 4 Hydrogen Five Hour Limit':'Gemini 4 Hydrogen 5 小时限额',
    'Gemini 5.1 Carbon 12-hour Limit':'Gemini 5.1 Carbon 12 小时限额',
    'ExamplePlugin Weekly Limit':'ExamplePlugin Weekly Limit',
    'gemini-4-argon-weekly-limit':'gemini-4-argon-weekly-limit',
    'Open URL in system browser: https://example.com/a?x=1':'在系统浏览器中打开网址：https://example.com/a?x=1',
    'Configure Example Server, values missing':'配置 Example Server，尚有值未填写',
    'View image attachment 2':'查看第 2 个图片附件',
    'Label for Open Sesame':'Open Sesame 的标签',
    'More for Copy File':'Copy File 的更多选项',
    'Turn 2 of 3':'第 2 / 3 轮对话',
    'Open Subagent: My Agent':'打开子智能体：My Agent',
    'You need at least 50 AI Credits to send messages. To continue using Claude Example 7 now, purchase more AI Credits.':'发送消息至少需要 50 个 AI 积分。若要立即继续使用 Claude Example 7，请购买更多 AI 积分。',
    'You need more AI Credits to send messages. To continue using this model now, purchase more AI Credits.':'发送消息需要更多 AI 积分。若要立即继续使用此模型，请购买更多 AI 积分。',
    'You need at least 0.5 AI Credits to send messages. To continue using Gemini Future now, purchase more AI Credits. Your plan\'s baseline quota will refresh on January 2, 2029.':'发送消息至少需要 0.5 个 AI 积分。若要立即继续使用 Gemini Future，请购买更多 AI 积分。你的方案基础配额将于 2029 年 1 月 2 日刷新。',
    'Your plan\'s baseline quota will refresh on November 18, 2030. To continue using this model now, enable AI Credit overages.':'你的方案基础配额将于 2030 年 11 月 18 日刷新。如需立即继续使用此模型，请启用 AI 积分超额使用。',
    'Your quota for this model has been reached. Switch to another available model to continue.':'此模型的配额已用尽。请切换到其他可用模型以继续。',
    'Your AI credits balance is too low to continue.':'你的 AI 积分余额不足，无法继续。',
    'For Google AI Ultra accounts, telemetry is force disabled.':'对于 Google AI Ultra 账号，遥测已被强制禁用。',
    'For your plan, this setting is disabled.':'对于你的方案，此设置已禁用。',
    'For Google AI Pro accounts, this setting is disabled. This means Antigravity does not collect any of your prompts, content, or model responses, but will still collect general usage patterns (e.g., feature adoption, active user counts).':'对于 Google AI Pro 账号，此设置已禁用。这意味着 Antigravity 不会收集你的提示、内容或模型回复，但仍会收集一般使用情况（例如功能采用情况和活跃用户数量）。',
    'You can upgrade to a Google AI Ultra plan to receive higher rate limits.':'你可以升级至 Google AI Ultra 方案，以获得更高的请求限额。',
    'Minimum length is 7':'最少输入 7 个字符',
    'Maximum value is 2.5':'最大值为 2.5',
    'Input must match ^[A-Z]{2}\\d+$':'输入必须匹配 ^[A-Z]{2}\\d+$'
  };
  const combinedLimitFixture=Object.keys(hiddenFixtures).find(text=>text.startsWith('Within each group, models share a weekly limit and a 5-hour limit.'));
  const updatedLimit=combinedLimitFixture.replace('is to smooth out aggregate demand and to fairly distribute','smooths out aggregate demand to fairly distribute');
  hiddenFixtures[updatedLimit]=hiddenFixtures[combinedLimitFixture];
  const updatedTwelve=updatedLimit.replaceAll('5-hour','12-hour');
  hiddenFixtures[updatedTwelve]=hiddenFixtures[combinedLimitFixture].replaceAll('5 小时','12 小时');
  const mismatchedLimit=combinedLimitFixture.replace('The 5-hour limit','The 6-hour limit');
  hiddenFixtures[mismatchedLimit]=mismatchedLimit;
  const prefixedLimit='Additional note: '+combinedLimitFixture;
  hiddenFixtures[prefixedLimit]=prefixedLimit;
  Object.assign(noticeFixtures,hiddenFixtures);
  Object.assign(noticeFixtures,JSON.parse("{\"Loading media...\": \"正在加载媒体…\", \"No compatible devices found.\": \"未找到兼容的设备。\", \"Project Required\": \"需要项目\", \"License Required\": \"需要许可证\", \"Loading runs…\": \"正在加载运行记录…\", \"No runs yet\": \"暂无运行记录\", \"No pinned conversations\": \"没有置顶会话\", \"The remote workspace is not running\": \"远程工作区未运行\", \"This field is required\": \"此项为必填项\"}"));
  const noticeTextNodes=Object.keys(noticeFixtures).map(text=>new TextNode(text));
  const noticeFixturesContainer=new Element('div',noticeTextNodes);
  const quotaDetail=new TextNode('Daily limit, resets in 2h 3m');
  const quotaPercent=new TextNode('45% left');
  const splitQuotaPercent=new Element('span',[new TextNode('45'),new TextNode('% left')]);
  const availableCredits=new TextNode('Available AI Credits: 100');
  const feedbackDescription=new TextNode('Please describe the issue in detail. The more actionable your feedback, the quicker our team can address your request. Some helpful information includes:');
  const feedbackIdentity=new TextNode('Send feedback as example@example.com');
  const inheritedTooltip=new Element('button',[],{title:'Inherits your Global Permissions when working in this project.'});
  const skillTitle=new TextNode('Science');
  const skillRow=new Element('div',[new Element('span',[skillTitle],{class:'font-medium flex-shrink-0 text-foreground'})],{class:'flex items-baseline gap-2.5 min-w-0'});
  const additionalDictionary={"This plugin provides a specialized suite of skills for data engineers and database practitioners working on Google Cloud. It acts as an expert assistant, allowing you to use natural language prompts in your preferred coding agent to architect complex data pipelines, transform data with dbt, write Spark and BigQuery SQL notebooks, and orchestrate end-to-end workflows across GCP's data ecosystem.": "为使用 Google Cloud 的数据工程师和数据库开发者提供专用技能。通过自然语言指令，让编程智能体协助设计复杂数据流水线、使用 dbt 转换数据、编写 Spark 和 BigQuery SQL 笔记本，并编排 GCP 数据生态中的完整工作流。", "Search and retrieve official documentation across Google Cloud, Gemini, Android, Firebase, Flutter, and Web. Requires Google Cloud credentials (ADC) or an API key.": "搜索和获取 Google Cloud、Gemini、Android、Firebase、Flutter 及 Web 的官方文档。需要 Google Cloud 凭据（ADC）或 API 密钥。", "Integration skill and tools for Google Maps Platform APIs": "提供 Google Maps Platform API 的集成技能和工具。", "Google Cloud guidance for coding agents: first-project onboarding, authentication and credential selection, and safety-critical validation for gcloud CLI commands. Includes the Google Developer Knowledge MCP server for grounded, up-to-date Google Cloud documentation.": "为编程智能体提供 Google Cloud 指南，涵盖首次项目配置、身份验证与凭据选择，以及 gcloud CLI 命令的关键安全校验。包含 Google Developer Knowledge MCP 服务器，可获取有据可查的最新 Google Cloud 文档。", "Keep your coding agent up to date with the latest web best practices.": "让编程智能体掌握最新的 Web 开发最佳实践。", "Develop ideas with context and review documents with fresh eyes.": "结合上下文构思创意，并以全新视角审阅文档。", "Official plugin for Dart and Flutter that installs Flutter/Dart Skills, Rules, Custom Agents, and Dart MCP server for building natively compiled, visually stunning applications for mobile, web, desktop, and embedded devices from a single codebase": "Dart 和 Flutter 官方插件，提供 Flutter/Dart 技能、规则、自定义智能体及 Dart MCP 服务器，帮助使用同一套代码为移动端、Web、桌面和嵌入式设备构建原生编译、界面精美的应用。", "Use Datadog directly in Antigravity through a preconfigured Datadog MCP server. Query logs, metrics, traces, dashboards, and more through natural conversation. This plugin is in preview.": "通过预配置的 Datadog MCP 服务器，在 Antigravity 中直接使用 Datadog。通过自然对话查询日志、指标、追踪、仪表板等内容。此插件目前为预览版。", "Investigate production issues with real Dynatrace data: problems and root causes, logs, metrics, traces, and vulnerabilities, via skills and the MCP server.": "通过技能和 MCP 服务器，使用真实的 Dynatrace 数据调查生产问题，包括问题与根因、日志、指标、追踪和漏洞。", "Packaged workflows for SCA remediation, AI SAST triage, CI/CD posture, malware response, findings review, Endor Labs setup, and more.": "提供预封装工作流，涵盖 SCA 修复、AI SAST 问题分诊、CI/CD 安全态势、恶意软件响应、发现项审查、Endor Labs 配置等。", "Build and debug pipelines, manage deployments, investigate security findings, and operate Harness with connected tools and reusable workflow skills.": "通过已连接的工具和可复用工作流技能，在 Harness 中构建与调试流水线、管理部署、调查安全发现项并执行运维操作。", "Respond to and investigate incidents, manage on-call schedules and escalations, and write runbooks and skills. Bundles the official incident.io MCP server.": "响应和调查事件、管理值班排班与升级流程，并编写运行手册和技能。包含 incident.io 官方 MCP 服务器。", "Connect your agent to invideo's AI-native video editor. It trims, grades and mixes on a real timeline while you watch every change land.": "将智能体连接到 invideo 的 AI 视频编辑器。它会在真实时间线上完成剪辑、调色和混音，你可以实时查看每一项更改。", "Search the web and read any page as clean markdown with Keenable, a search engine built for AI agents. Keyless: no signup or API key needed.": "使用专为 AI 智能体打造的搜索引擎 Keenable 搜索网页，并将任意页面读取为整洁的 Markdown。无需注册或 API 密钥。", "Ask a question of the live web and get a table back. Keenable SELECT runs many searches, reads the pages and extracts the fields you need in one call. Sign in with a Keenable account.": "向实时网络提问并获得表格结果。Keenable SELECT 可在一次调用中执行多次搜索、阅读页面并提取所需字段。需要登录 Keenable 账号。", "Create, run and debug Leapwork Play tests and runlists, build agents, and hand work to Play's AI workflows, right from Antigravity.": "直接在 Antigravity 中创建、运行和调试 Leapwork Play 测试与运行列表，构建智能体，并将工作交给 Play 的 AI 工作流。", "Real salaries and company levels from Levels.fyi: check if an offer is fair, compare offers, find jobs with pay shown and add your own salary.": "使用 Levels.fyi 的真实薪资和公司职级数据，评估录用报价是否合理、比较报价、寻找公开薪资的职位，并提交自己的薪资信息。", "Official Antigravity plugin for MongoDB Atlas (hosted MCP Server + Skills). Connect to the MongoDB-hosted Atlas MCP server, explore data, manage collections, optimize queries, generate reliable code, implement best practices, develop advanced features, and more.": "MongoDB Atlas 的 Antigravity 官方插件，包含托管 MCP 服务器和技能。连接 MongoDB 托管的 Atlas MCP 服务器，探索数据、管理集合、优化查询、生成可靠代码、实施最佳实践并开发高级功能。", "Agent skills for Neo4j graph database — write Cypher queries, design graph models, use drivers, run imports, build GraphRAG pipelines, run GDS algorithms, and manage Aura instances.": "Neo4j 图数据库智能体技能：编写 Cypher 查询、设计图模型、使用驱动程序、导入数据、构建 GraphRAG 流水线、运行 GDS 算法并管理 Aura 实例。", "Search the live web and fetch page content with Parallel's hosted MCP server. Free access with no Parallel account, API key, or Parallel CLI required.": "通过 Parallel 托管的 MCP 服务器搜索实时网络并获取页面内容。可免费使用，无需 Parallel 账号、API 密钥或 Parallel CLI。", "Agent plugin for PingOne multi-tenant. Includes skills and a remote MCP server that lets AI agents configure and monitor your PingOne environments.": "面向 PingOne 多租户环境的智能体插件，包含技能和远程 MCP 服务器，让 AI 智能体配置与监控 PingOne 环境。", "Equip Antigravity with specialized Postman skills for the complete API lifecycle. Discover, design, test, document, mock, monitor, and improve APIs through agent-friendly, filesystem-first workflows.": "为 Antigravity 提供覆盖 API 完整生命周期的 Postman 专用技能。通过适合智能体、以文件系统为基础的工作流，发现、设计、测试、编写文档、模拟、监控和改进 API。", "Set up Qodo, explore code and repository history, review local changes, and resolve pull-request findings directly from Antigravity.": "直接在 Antigravity 中配置 Qodo、探索代码和仓库历史、审查本地更改，并处理拉取请求中的审查发现项。", "Query your SentinelOne Singularity Console from Antigravity through a self-hosted, read-only Purple AI MCP server. Requires an active console deployment, your console URL, and an API token.": "通过自行托管的只读 Purple AI MCP 服务器，在 Antigravity 中查询 SentinelOne Singularity 控制台。需要已部署并运行的控制台、控制台网址和 API 令牌。", "Set up Sentry monitoring, investigate production errors, and configure alerts and releases with expert skills and live context from your Sentry projects.": "通过专业技能及 Sentry 项目的实时上下文，配置 Sentry 监控、调查生产环境错误，并设置警报和发布。", "Triage Exabeam New-Scale alerts and cases end to end: gather the evidence, map MITRE, reach a verdict, and record it behind an approval step.": "完整分诊 Exabeam New-Scale 警报和事件：收集证据、映射 MITRE、形成结论，并在获得批准后记录结果。", "SonarQube is the AI code quality and security verification platform used by millions of developers to catch bugs, vulnerabilities, and leaked secrets. This plugin enforces those standards in the agent coding loop: 7,500+ distinct issue types, secrets scanning, agentic analysis, and quality gates across 40+ languages.": "SonarQube 是数百万开发者使用的 AI 代码质量与安全验证平台，可发现缺陷、漏洞和泄露的密钥。此插件在智能体编程流程中执行这些标准，涵盖 7,500 多种问题类型、密钥扫描、智能体分析，以及 40 多种语言的质量门禁。", "Turn an idea into a website, dashboard, report, or small web tool you can share. Build it in chat or bring your own work, and publish it with Spacefast.": "将想法变成可分享的网站、仪表板、报告或小型 Web 工具。在会话中构建，或带入已有作品，再使用 Spacefast 发布。", "Official Supabase plugin for Antigravity with Supabase skills and MCP access for project management, database work, auth, storage, and Postgres best practices.": "Antigravity 的 Supabase 官方插件，提供 Supabase 技能和 MCP 访问，支持项目管理、数据库操作、身份验证、存储和 Postgres 最佳实践。", "Make your coding agent a better engineer": "让编程智能体成为更出色的工程师。", "Web search, content extraction, website crawling, URL discovery, and deep research for Antigravity via Tavily's hosted MCP server and skills.": "通过 Tavily 托管的 MCP 服务器和技能，为 Antigravity 提供网页搜索、内容提取、网站抓取、网址发现和深入研究功能。", "Official Trello plugin with the Trello MCP server and a skill for boards, lists, cards, checklists, Inbox, and Planner.": "Trello 官方插件，包含 Trello MCP 服务器及相关技能，可管理看板、列表、卡片、检查清单、收件箱和规划器。", "Unity's official plugin for Antigravity, with curated skills for game development, monetization, and performance optimization.": "Unity 的 Antigravity 官方插件，包含精选技能，支持游戏开发、变现和性能优化。", "Investigate files, URLs, domains and IP addresses with VirusTotal threat intelligence, analysis and submission recovery.": "使用 VirusTotal 的威胁情报、分析及提交结果恢复功能，调查文件、网址、域名和 IP 地址。", "Connect 9,000+ apps to your AI workflow. Discover, enable, and execute Zapier actions and workflows directly from your client.": "将 9,000 多款应用连接到 AI 工作流。在客户端中直接发现、启用并执行 Zapier 操作和工作流。", "Build on Zoho CRM v8: REST API, Deluge functions, ClientScript, widgets, COQL and connections, with live CRM data through your Zoho MCP server.": "基于 Zoho CRM v8 开发，支持 REST API、Deluge 函数、ClientScript、小组件、COQL 和连接，并通过 Zoho MCP 服务器访问实时 CRM 数据。", "Zoho Desk plugin for Antigravity. Review, prioritize, and update Zoho Desk tickets directly from Antigravity through Zoho Desk MCP and includes a Ticket Prioritization Agent for triage and priority updates.": "Antigravity 的 Zoho Desk 插件。通过 Zoho Desk MCP 直接审阅、排序和更新工单，并提供工单优先级智能体进行分诊与优先级更新。", "Connect Zoho Projects to Antigravity to turn tasks and issues into working code. Access project context, investigate bugs, and update work items as you develop.": "将 Zoho Projects 连接到 Antigravity，把任务和问题转化为可用代码。开发时可访问项目上下文、调查缺陷并更新工作项。", "Run Zoho Books from Antigravity: invoicing, bills, banking, journals, projects, items, taxes, customization and automation.": "在 Antigravity 中使用 Zoho Books，处理开票、账单、银行业务、日记账、项目、商品、税务、自定义配置和自动化。", "Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work, their loading priority, discovery mechanisms, and to guide the creation of skills, rules, plugins, hooks, and MCP servers.": "Antigravity 自定义配置系统的完整指南与参考。用于说明自定义项的工作方式、加载优先级和发现机制，并指导创建技能、规则、插件、钩子和 MCP 服务器。", "Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars). Activate this skill when the user asks questions about how to use, configure, or customize Antigravity, AGY, the agy CLI, the Antigravity IDE, or Antigravity 2.0.": "提供 Google Antigravity（AGY）的完整指南、速查表和功能索引，涵盖 Antigravity CLI（agy）、Antigravity 2.0、Antigravity IDE、Python SDK、斜杠命令、快捷键及自定义配置（技能、规则、MCP、侧边扩展）。用户询问这些产品的使用、配置或自定义方式时启用此技能。", "Interactive guide to design and create a scheduled background automation. Use this skill when the user wants to create an automated or recurring scheduled task (e.g. \"summarize my emails every morning\", \"every Monday send me a to-do list\"). Also triggered by the /automation slash command.": "通过交互式指南设计和创建定时后台自动化任务。用户希望创建自动化或定期任务时使用，例如每天早晨汇总邮件、每周一发送待办清单。也可通过 /automation 斜杠命令触发。", "How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.": "介绍如何在会话中内嵌丰富的交互式 HTML 小组件，或将其作为独立成果展示。需要向用户显示图表、数据可视化、交互控件、教学演示或超出纯文本与 Markdown 的视觉内容时使用。", "Build, package, and debug MCP Apps for Antigravity: MCP server tools whose results render as interactive UI in the conversation, in the side pane, or full-page from the sidebar. Use when adding a UI to an MCP tool, building or theming the app itself, packaging it as a plugin, or debugging an app that doesn't render or behave as expected.": "为 Antigravity 构建、打包和调试 MCP 应用，让 MCP 工具结果在会话、侧边面板或从侧栏打开的全屏页面中呈现为交互界面。为 MCP 工具添加界面、构建或调整应用主题、打包为插件，或排查显示和行为异常时使用。", "Migrates the user's MCP servers, skills, slash commands, subagents, and instruction files from other coding agents (Claude Code, Codex, Cursor, Gemini CLI) into one new Antigravity plugin. Use when the user wants to bring over, import, or migrate their setup or config from another agent or tool. Don't use for installing Marketplace plugins or authoring a new plugin from scratch (use the plugin skill).": "将其他编程智能体（Claude Code、Codex、Cursor、Gemini CLI）的 MCP 服务器、技能、斜杠命令、子智能体和指令文件迁移到一个新的 Antigravity 插件中。用户希望导入或迁移其他工具的配置时使用；安装插件市场插件或从零创建插件时请使用 plugin 技能。", "Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.": "自动将全局和工作区配置中的旧版工作流迁移为现代技能。扫描现有工作流、创建目标 SKILL.md 文件，并安全归档旧工作流文件。", "(Preview & Quota Heavy) Run a swarm: several agents working in parallel on one task, each in its own conversation, collaborating through a shared message board. Use when the work splits into pieces that can be done at the same time, or when a second pair of eyes should check the first pair's work.": "（预览功能，配额消耗较高）运行多个并行协作的智能体，每个智能体都有独立会话，并通过共享消息板共同处理任务。工作可拆分为并行部分，或需要第二位智能体复核时使用。", "Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.": "提供与 GitHub 交互的指南，并在命令因智能体环境限制而失败时向用户申请权限。", "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit. Use this skill when the user wants to enable, disable, install or uninstall a plugin, when they want to create a new plugin, or when a new customization should be packaged into a plugin rather than left loose. Also triggered by the /plugin slash command. Don't use for the underlying customization system itself — discovery roots, loading priority, or authoring a standalone skill, agent, rule, hook or MCP server outside a plugin; see the customizations guide skill for those.": "介绍如何管理和创建插件：将技能、智能体、规则、MCP 服务器和钩子打包到命名空间中，作为整体安装、启用或停用。用户希望启用、停用、安装、卸载或创建插件，或需要将新自定义项打包成插件时使用。也可通过 /plugin 触发。有关发现目录、加载优先级，或在插件之外编写独立自定义项，请参阅自定义配置指南技能。", "How to write and run a dynamic workflow script with the `run_workflow` tool: a Python script that orchestrates many agents with `agent`, `parallel`, `pipeline`, and `phase`. Use when a task splits into many independent or staged pieces of agent work (fan out over files, modules, bugs, or review angles, then aggregate), or when the user asks for a workflow. Don't use for a single delegated task (use a subagent) or for legacy workflow files (see migrate-workflows).": "介绍如何使用 run_workflow 工具编写和运行动态工作流脚本：通过 Python 脚本，使用 agent、parallel、pipeline 和 phase 编排多个智能体。任务可拆分为多个独立或分阶段工作（例如并行处理文件、模块、缺陷或审查角度后再汇总），或用户要求工作流时使用。单个委派任务请使用子智能体；旧版工作流文件请参阅 migrate-workflows。", "ONLY for the native-swarm worker whose brief says it is the monitor. On a timer, it checks whether the whole swarm has stalled and calls on the one member who can unstick it. Coordinators and other workers: do not load this.": "仅供任务说明中明确指定为监控员的原生 Swarm 工作智能体使用。它会定期检查整个智能体群是否停滞，并呼叫能解决阻塞的成员。协调者和其他工作智能体请勿加载。", "ONLY for the native-swarm worker whose brief says it is the narrator. It watches the board and keeps the facts behind the user's Overview (view.json) current. Coordinators and other workers: do not load this.": "仅供任务说明中明确指定为叙述员的原生 Swarm 工作智能体使用。它会关注消息板，并保持用户概览（view.json）中的事实信息最新。协调者和其他工作智能体请勿加载。", "Discover UI plugin panels relevant to the current task and surface a one-click pill in chat to open (toggle) them in the side pane. Use when a running UI plugin's panel would help with what the user is doing, or right after the user enables a new UI plugin pane and a shortcut to open it is handy.": "发现与当前任务相关的 UI 插件面板，并在会话中显示可一键打开或切换侧边面板的快捷入口。正在运行的插件面板有助于当前工作，或用户刚启用了新的插件面板、需要打开捷径时使用。", "Unlock the power of agent swarms.": "释放多个智能体协作的力量。", "More Plugins": "更多插件", "Explore other marketplace customizations": "探索插件市场中的其他自定义项", "Bundled With the App": "应用内置", "Included in:": "包含于：", "Included by": "由以下项提供", "Listed in Your Config": "已列入你的配置", "Found in This Workspace": "在此工作区中发现", "The suggested plugin isn't in the marketplace.": "推荐的插件不在插件市场中。", "Local only": "仅本地", "Remote only": "仅远程", "Sign in needed": "需要登录", "The skill is now available": "此技能现已可用", "Its customizations are now available": "其自定义项现已可用", "Open plugin page": "打开插件页面", "Plugin metadata": "插件信息", "Context usage": "上下文用量", "Managed by plugin": "由插件管理", "This plugin was force disabled.": "此插件已被强制停用。", "Install this plugin to see the commands it adds, along with its skills, agents and MCP servers.": "安装此插件后，即可查看它提供的命令、技能、智能体和 MCP 服务器。", "Failed to load bundle. Please try again.": "无法加载插件包，请重试。", "Removing the bundle removes all of its plugins.": "移除插件包会同时移除其中的全部插件。", "You can also add or remove each plugin below.": "你也可以在下方单独添加或移除每个插件。", "Each plugin can be managed on its own.": "每个插件都可以单独管理。", "This bundle has no plugins yet.": "此插件包中暂时没有插件。", "Create plugin": "创建插件", "Enable recommended skills": "启用推荐技能", "See more": "查看更多", "Failed to load your customizations. Please try again.": "无法加载你的自定义配置，请重试。", "Loading customizations...": "正在加载自定义配置…", "No customizations match your search.": "没有匹配搜索条件的自定义项。", "No custom agents yet.": "暂无自定义智能体。", "Failed to load more plugins. Please try again.": "无法加载更多插件，请重试。", "Find skills, agents, and more in the Marketplace.": "在插件市场中发现技能、智能体和更多内容。", "No matching plugins found.": "未找到匹配的插件。", "See more in Plugins": "查看更多插件", "See less in Plugins": "收起插件", "No plugins match your search.": "没有匹配搜索条件的插件。", "No apps connected yet. Connect one from Marketplace.": "尚未连接任何应用，请从插件市场中连接。", "Apps connected to your account": "已连接到你账号的应用", "Sign in to an app once and your agent can use it on any device. Open an app to see the account it uses or to disconnect it.": "登录应用一次后，智能体便可在任何设备上使用它。打开应用可查看其使用的账号，或断开连接。", "Replacing removes the currently installed plugin and installs the new one in its place.": "替换会移除当前安装的插件，并在原位置安装新插件。", "This skill came from the marketplace, so you can add it again whenever you need it.": "此技能来自插件市场，你可以随时重新添加。"};
  const additionalTexts=Object.keys(additionalDictionary).map(text=>new TextNode(text));
  const additionalContainer=new Element('div',additionalTexts);
  const detailPrompts={"Create a PySpark notebook to train a distributed Random Forest model on the BigQuery table my_transactions": "创建一个 PySpark 笔记本，在 BigQuery 表 my_transactions 上训练分布式随机森林模型", "Find datasets about customer orders in Knowledge Catalog and show their lineage": "在 Knowledge Catalog 中查找客户订单相关数据集，并展示其数据血缘", "My last Dataflow job failed. Find the root cause in the logs and propose a fix": "我上一次 Dataflow 作业失败了。请从日志中查找根因，并提出修复方案", "Book 30 minutes with Priya and Sam next week": "下周安排一次与 Priya 和 Sam 的 30 分钟会议", "What's on my calendar today? Flag any conflicts": "今天我的日历上有哪些安排？请标出时间冲突", "Block focus time before Friday's launch review": "在周五的发布评审前预留专注工作时间", "Summarize this design doc and list the open questions": "总结这份设计文档，并列出尚未解决的问题", "Draft a launch announcement in a new doc from my notes": "根据我的笔记，在新文档中起草一份发布公告", "Reply to the open comments on my doc and resolve them": "回复我文档中尚未处理的评论，并将其标记为已解决", "Find last quarter's budget and share it with Alex": "找到上季度的预算，并与 Alex 分享", "Move this week's design exports into the Launch folder": "将本周导出的设计文件移入 Launch 文件夹", "Download the Q3 report as a PDF": "将第三季度报告下载为 PDF", "Summarize my unread emails from today": "总结我今天的未读邮件", "Draft a reply to the latest thread about launch readiness": "为最新的发布准备情况邮件会话起草回复", "Find emails with attachments from last week": "查找上周带有附件的邮件", "Find the trends and outliers in this sales sheet": "找出这份销售表中的趋势和异常值", "Build a monthly budget tracker with formulas and a chart": "创建一个带公式和图表的月度预算跟踪表", "Import this CSV and turn it into a pivot table by region": "导入这个 CSV，并按地区生成数据透视表", "Turn my project notes into a 10-slide pitch deck": "将我的项目笔记制作成一份 10 页的推介演示文稿", "Add a summary slide and speaker notes to my review deck": "为我的评审演示文稿添加总结页和演讲者备注", "Export the final deck as a PDF": "将最终演示文稿导出为 PDF", "Create a new Android project called MyFirstApp using the empty-activity template": "使用 empty-activity 模板，创建一个名为 MyFirstApp 的 Android 项目", "Run my app on a Samsung Galaxy Ultra device.": "在 Samsung Galaxy Ultra 设备上运行我的应用。", "Test my app and make sure that it's ready to publish to Google Play.": "测试我的应用，并确认它已准备好发布到 Google Play。", "Set up Firebase in my app and connect it to a Firebase project": "在我的应用中配置 Firebase，并连接到一个 Firebase 项目", "Add Firebase Authentication with Google sign-in to my app": "为我的应用添加支持 Google 登录的 Firebase Authentication", "Write and audit Firestore security rules for my data model": "为我的数据模型编写并审查 Firestore 安全规则", "Add a Gemini-powered feature to my app with Firebase AI Logic": "使用 Firebase AI Logic，为我的应用添加由 Gemini 驱动的功能", "Deploy my web app with Firebase App Hosting": "使用 Firebase App Hosting 部署我的 Web 应用", "Look up the exact gcloud CLI command and IAM roles needed to deploy a Cloud Run service with Secret Manager": "查找部署使用 Secret Manager 的 Cloud Run 服务所需的准确 gcloud CLI 命令及 IAM 角色", "Search official Google documentation for how to implement structured outputs with the Gemini API": "搜索 Google 官方文档，了解如何使用 Gemini API 实现结构化输出", "Compare Cloud Run, GKE Autopilot, and App Engine based on official Google Cloud architecture guides": "根据 Google Cloud 官方架构指南，比较 Cloud Run、GKE Autopilot 和 App Engine", "Build a stateful multi-turn chat script using the Interactions API and the latest models": "使用 Interactions API 和最新模型，编写支持状态保留的多轮会话脚本", "Create a real-time voice agent using the Gemini Live API and non-blocking function calling": "使用 Gemini Live API 和非阻塞函数调用，创建实时语音智能体", "Migrate my project from client.models.generate_content to the Interactions API": "将我的项目从 client.models.generate_content 迁移到 Interactions API", "Help me set up a new Google Cloud project, link billing, and configure local authentication.": "帮我配置一个新的 Google Cloud 项目、关联结算账号，并设置本地身份验证。", "Configure Application Default Credentials (ADC) and IAM permissions for my local development environment.": "为我的本地开发环境配置应用默认凭据（ADC）和 IAM 权限。", "Search official Google Cloud documentation using Developer Knowledge and validate my gcloud CLI commands.": "使用 Developer Knowledge 搜索 Google Cloud 官方文档，并校验我的 gcloud CLI 命令。", "Audit this project for modern web best practices and modernization opportunities": "审查这个项目是否遵循现代 Web 最佳实践，并找出可升级改进的地方", "What is the recommended modern way to implement responsive dialogs and popovers?": "现在推荐用什么方式实现响应式对话框和弹出层？", "Build a Chrome Extension with a side panel using Manifest V3 best practices": "遵循 Manifest V3 最佳实践，构建带侧边面板的 Chrome 扩展", "Build a responsive Flutter layout that adapts across mobile, tablet, and desktop form factors": "构建可适配手机、平板和桌面设备的响应式 Flutter 布局", "Write a widget test using WidgetTester to verify UI rendering and user interactions": "使用 WidgetTester 编写小组件测试，验证界面渲染和用户交互", "Audit my app for accessibility": "审查我的应用的无障碍支持", "Diagnose and fix layout overflows or constraint issues in this Flutter widget": "诊断并修复这个 Flutter 小组件的布局溢出或约束问题", "List available Looker models and explores in my instance": "列出我的 Looker 实例中可用的模型和 Explore", "Run a query against an explore and summarize the top trends": "在一个 Explore 中运行查询，并总结主要趋势", "Check the health of my Looker instance and dashboards": "检查我的 Looker 实例和仪表板的运行状况", "List our active Stripe products and their recurring subscription prices": "列出我们当前启用的 Stripe 产品及其定期订阅价格", "Create a Stripe payment link for a $49/month Pro plan": "为每月 49 美元的 Pro 方案创建 Stripe 付款链接", "Search Stripe documentation for how to verify webhook signatures": "搜索 Stripe 文档，了解如何验证 Webhook 签名", "List my Arize projects and show recent traces with errors": "列出我的 Arize 项目，并显示近期出现错误的追踪记录", "Add Arize tracing to this application": "为这个应用添加 Arize 追踪", "Show the prompt version labeled production in my Arize Prompt Hub": "显示我的 Arize Prompt Hub 中标记为 production 的提示词版本", "Help me implement [JIRA-123]. Retrieve the requirements, acceptance criteria, and linked design decisions. Inspect this repository and propose an implementation plan before changing code.": "帮我实现 [JIRA-123]。获取需求、验收标准和关联设计决策。先检查这个仓库并提出实施计划，再修改代码。", "Investigate [JIRA-123] in this repository. Find related bugs, previous fixes, and relevant technical decisions. Recommend a fix and the tests needed to verify it.": "在这个仓库中调查 [JIRA-123]。查找相关缺陷、以往修复和相关技术决策，提出修复方案及验证所需的测试。", "Review my current changes against [JIRA-123] and its linked specification. Flag missed requirements, conflicting decisions, and missing tests.": "根据 [JIRA-123] 及其关联规范审查我当前的更改，标出遗漏的需求、相互冲突的决策和缺失的测试。", "Add Auth0 login to my app": "为我的应用添加 Auth0 登录", "Debug why my Auth0 login is failing": "排查我的 Auth0 登录失败的原因", "Audit my Auth0 tenant's health and security": "审查我的 Auth0 租户的运行状况和安全性", "Create a new Base44 app with a Task entity and deploy it": "创建一个包含 Task 实体的 Base44 应用并部署", "Add a backend function to my Base44 app that sends a welcome email": "为我的 Base44 应用添加一个发送欢迎邮件的后端函数", "Check my Base44 function logs and find why requests are failing": "检查我的 Base44 函数日志，查找请求失败的原因", "Show me all monitors that are currently down.": "显示当前所有处于故障状态的监控项。", "Who's on call right now?": "现在是谁值班？", "Create a dashboard showing error rates for my API service.": "创建一个显示我的 API 服务错误率的仪表板。", "Go to Hacker News and get the top 5 stories": "前往 Hacker News，获取排名前 5 的新闻", "Open browserbase.com and take a screenshot of the pricing page": "打开 browserbase.com，为价格页面截取屏幕截图", "Find the latest release notes for Stagehand and summarize them": "找到 Stagehand 最新版本的发布说明并总结", "Resize this Canva design for Instagram and LinkedIn": "调整这份 Canva 设计的尺寸，使其适合 Instagram 和 LinkedIn", "Review this Canva design and suggest improvements": "审阅这份 Canva 设计并提出改进建议", "Check this Canva design against my brand kit": "根据我的品牌套件检查这份 Canva 设计", "Deploy this project to Cloudflare Workers": "将这个项目部署到 Cloudflare Workers", "Which Cloudflare storage fits this app: D1, KV, R2 or Durable Objects?": "这款应用适合使用哪种 Cloudflare 存储：D1、KV、R2 还是 Durable Objects？", "List my Cloudflare zones and Workers and flag anything that needs attention": "列出我的 Cloudflare 区域和 Workers，标出需要关注的事项", "How do I set up a proxy in the latest Next.js?": "如何在最新版 Next.js 中配置代理？", "Show me how to define relations in Prisma": "演示如何在 Prisma 中定义关联", "What are the Supabase auth methods?": "Supabase 支持哪些身份验证方式？", "Show me new high severity detections from the last 7 days": "显示最近 7 天内新增的高严重程度检测结果", "Find threat actors targeting financial services": "查找针对金融服务行业的威胁组织", "Which MCP servers have AI agents connected to across the fleet?": "整个终端群中的 AI 智能体连接过哪些 MCP 服务器？", "Show me error logs for the \"checkout\" service from the last hour": "显示 checkout 服务过去一小时的错误日志", "What monitors are currently alerting?": "目前哪些监控正在触发警报？", "Find traces for service \"api-gateway\" with latency > 500ms": "查找 api-gateway 服务中延迟超过 500ms 的调用链", "Find and summarize the Q4 planning deck in Dropbox": "在 Dropbox 中查找并概述第四季度规划演示文稿", "Create a shared link for the Launch folder": "为 Launch 文件夹创建共享链接", "Review duplicate exports in this folder and ask before deleting anything": "检查此文件夹中重复的导出文件，删除任何内容前先询问我", "What are the active problems in my Dynatrace environment and their root causes?": "我的 Dynatrace 环境中目前有哪些问题，根本原因是什么？", "Show me the top error logs from the last hour and the services producing them": "显示过去一小时内最主要的错误日志及其来源服务", "Write a DQL query for the p95 response time of my slowest services": "编写 DQL 查询，获取最慢服务的 p95 响应时间", "Use the SCA remediation agent to fix the P0 findings in this repo for my tenant": "使用 SCA 修复智能体，为我的租户修复此代码仓库中的 P0 发现项", "Triage the top AI SAST findings for my repo and propose a PR to fix them": "对我代码仓库中的主要 AI SAST 发现项进行分流，并提出用于修复的 PR", "Plan a safe dependency remediation using Endor Labs evidence": "根据 Endor Labs 的证据制定安全的依赖修复计划", "Implement this Figma frame as a React component: <link>": "将此 Figma 画框实现为 React 组件：<link>", "Connect my Button component to its Figma component with Code Connect": "使用 Code Connect 将我的 Button 组件关联到对应的 Figma 组件", "Create a Figma design for a login screen that matches my design system": "创建符合我的设计系统的 Figma 登录界面设计", "Ask Grafana Assistant why checkout latency is spiking right now": "询问 Grafana Assistant，为什么 checkout 的延迟现在突然升高", "Investigate errors from the latest deployment": "调查最新部署产生的错误", "Summarize active incidents and related alerts": "汇总正在处理的事件及相关警报", "What did we decide in my meetings this week?": "本周我的会议做出了哪些决定？", "What action items came out of my last meeting?": "我上次会议产生了哪些行动项？", "Summarize what my team discussed about this project": "汇总我的团队对该项目的讨论", "List recent failed pipelines in my Harness project and explain the failures.": "列出我的 Harness 项目中近期失败的流水线，并解释失败原因。", "Create a CI pipeline for this repository and show me the YAML before saving.": "为此代码仓库创建 CI 流水线，保存前先向我展示 YAML。", "Review deployment readiness for my Harness service.": "检查我的 Harness 服务是否已准备好部署。", "Run the extensions skill": "运行 extensions 技能", "What incidents are open right now?": "目前有哪些尚未解决的事件？", "Who's on call this week?": "本周谁值班？", "Show me the most common topics in open Intercom conversations this week": "显示本周尚未结束的 Intercom 对话中最常见的话题", "Summarize every Intercom conversation from jane@example.com": "汇总来自 jane@example.com 的每条 Intercom 对话", "Install the Intercom Messenger in this app with identity verification": "在此应用中安装带身份验证功能的 Intercom Messenger", "List my invideo projects": "列出我的 invideo 项目", "Edit the clips in this folder into a 30-second vertical ad in invideo with captions and music": "使用 invideo 将此文件夹中的片段剪辑成 30 秒竖屏广告，并添加字幕和音乐", "Edit this video in invideo: trim the pauses, grade it golden hour, duck the music": "在 invideo 中编辑此视频：剪掉停顿，调成黄金时段色调，并在说话时降低背景音乐音量", "Find the release notes for the libraries in this project since our pinned versions and list the breaking changes": "查找本项目所用库自当前锁定版本以来的发行说明，并列出不兼容变更", "Search github.com for reports of this error from the last 30 days and tell me if there is a known fix": "在 github.com 上搜索最近 30 天内关于此错误的报告，告诉我是否已有已知修复方法", "Research the leading agent observability tools and compare them in a table with a source for every claim": "调研主流智能体可观测性工具，用表格进行比较，并为每项结论提供来源", "Which open-source vector databases come up most in 2026 comparisons? Give me a table with license, latest version and a source for each": "在 2026 年的比较文章中，哪些开源向量数据库出现得最多？请用表格列出许可证、最新版本及各项来源", "List AI agent startups that announced a seed round in the last 30 days, with amount, lead investor and source": "列出最近 30 天宣布种子轮融资的 AI 智能体初创公司，并附上融资额、领投方和来源", "Compare the pricing of the main LLM observability tools in one table: free tier, paid entry price, what is metered": "用一张表比较主流 LLM 可观测性工具的价格：免费额度、付费入门价格以及计费指标", "Create a test case for this bug in Leapwork": "在 Leapwork 中为此问题创建测试用例", "Run my Leapwork runlist and show me what failed": "运行我的 Leapwork 运行列表，并显示失败项", "Find out why my last Leapwork run failed and fix the failing step": "查明我上次 Leapwork 运行失败的原因，并修复失败步骤", "I'm a Google L5 in Seattle making $190k base and $120k stock a year. Am I underpaid?": "我在西雅图担任 Google L5，年基本工资 $190k、股票 $120k。我的薪酬偏低吗？", "I have a Stripe offer: $210k base, $400k RSUs over 4 years. Is it good?": "我收到 Stripe 的录用报价：基本工资 $210k，4 年归属的 RSU 共 $400k。这个待遇好吗？", "Find remote product manager jobs that pay at least $200k base.": "查找基本年薪至少 $200k 的远程产品经理职位。", "Show my assigned Linear issues, grouped by priority.": "显示分配给我的 Linear 问题，并按优先级分组。", "Summarize recent updates to my Linear projects.": "汇总我的 Linear 项目的近期更新。", "Find Linear issues related to the code I am working on.": "查找与我正在编写的代码相关的 Linear 问题。", "Find home screen examples from banking apps and save them to a collection": "查找银行应用的首页设计示例，并保存到收藏集中", "Compare how AI tools design their pricing sections": "比较各类 AI 工具的定价版块设计", "Review my paywall screen against the ones I saved in collections": "参考我保存到收藏集中的示例，评审我的付费墙界面", "Onboard me to monday.com": "带我入门 monday.com", "Create a monday.com item for each TODO in this file and assign them to me": "为此文件中的每个 TODO 创建一个 monday.com 工作项，并分配给我", "Create a monday.com bug report form with summary, steps to reproduce and severity questions": "创建 monday.com 问题报告表单，包含摘要、复现步骤和严重程度问题", "List my Atlas clusters and the databases on each one": "列出我的 Atlas 集群以及每个集群中的数据库", "Review the schema of my orders collection and suggest improvements": "审查我的 orders 集合的结构，并提出改进建议", "Find slow queries on my Atlas cluster and recommend indexes": "查找我的 Atlas 集群中的慢查询，并推荐索引", "Design a graph data model for my application's domain": "为我的应用领域设计图数据模型", "Write and optimize a Cypher query to find related nodes": "编写并优化用于查找相关节点的 Cypher 查询", "Build a GraphRAG pipeline with Neo4j vector indexes": "使用 Neo4j 向量索引构建 GraphRAG 流水线", "Deploy this project to Netlify": "将此项目部署到 Netlify", "Add a Netlify Function that serves a JSON API endpoint": "添加一个提供 JSON API 端点的 Netlify Function", "Store and query this app's data with Netlify Database": "使用 Netlify Database 存储和查询此应用的数据", "Set up Notion so you can use my workspace as context": "配置 Notion，以便你将我的工作区用作上下文", "Turn this spec in Notion into an implementation plan with tasks": "将 Notion 中的这份规格说明转为包含任务的实施计划", "Write a weekly update for my project from what changed in Notion": "根据 Notion 中的变化，为我的项目撰写每周进展", "List my 5 most recently modified PandaDoc documents with their status.": "列出我最近修改的 5 份 PandaDoc 文档及其状态。", "Show my signing pipeline and identify documents that are stuck.": "显示我的签署流程，并找出停滞的文档。", "Find unsigned documents and draft follow-up messages without sending them.": "查找未签署的文档，并起草跟进消息，暂不发送。", "Use Parallel to find the upgrade guide for this project's main framework and tell me what we'd need to change.": "使用 Parallel 查找本项目主要框架的升级指南，说明需要修改哪些内容。", "Use Parallel to find official docs and examples for the feature we're building. Match the versions in this project.": "使用 Parallel 查找我们正在开发的功能的官方文档和示例，版本应与本项目一致。", "Use Parallel to look up this error in official docs and GitHub issues, then suggest a fix with sources.": "使用 Parallel 在官方文档和 GitHub 问题中查询此错误，然后给出附有来源的修复建议。", "Register a new OIDC application and connect it to a login flow in my PingOne environment.": "在我的 PingOne 环境中注册一个新的 OIDC 应用，并将其连接到登录流程。", "Enable MFA for this user — complete common user security and access tasks.": "为此用户启用 MFA，并完成常见的用户安全与访问任务。", "Investigate audit logs for suspicious activity, jamie@example.com had trouble signing on this afternoon. What happened?": "检查审计日志中的可疑活动。jamie@example.com 今天下午登录遇到了问题，发生了什么？", "Create a collection for the API in this repo, add tests, and run them.": "为此仓库中的 API 创建一个集合，添加测试并运行。", "I'm changing the credit card service. What APIs in my company use it?": "我正在修改信用卡服务，公司中有哪些 API 在使用它？", "What depends on the billing-api collection, and what would changing its response schema break?": "哪些内容依赖 billing-api 集合？更改其响应结构会破坏哪些功能？", "Connect my Qodo account and verify this coding agent is ready.": "连接我的 Qodo 账号，并确认此编程智能体已准备就绪。", "Explain how this code works, including its history and cross-repository impact.": "解释这段代码的工作原理，包括它的历史和对其他仓库的影响。", "Review my local changes with Qodo before I push them.": "在我推送之前，使用 Qodo 审查本地更改。", "Deploy this app to Railway": "将此应用部署到 Railway。", "Check the Railway status for this project": "检查此项目在 Railway 上的状态。", "Debug my latest failed Railway deployment": "调试我最近一次失败的 Railway 部署。", "Run a technical SEO audit on example.com": "对 example.com 执行技术 SEO 审计。", "Find keyword ideas for project management software": "为项目管理软件寻找关键词创意。", "Who are the real search competitors of example.com?": "example.com 在搜索领域的真正竞争对手是谁？", "Summarize the highest-severity open alerts in my SentinelOne console": "汇总我的 SentinelOne 控制台中严重程度最高的未处理警报。", "Ask Purple AI which endpoints showed suspicious PowerShell activity this week": "询问 Purple AI，本周哪些端点出现了可疑的 PowerShell 活动。", "Show me the vulnerable applications in my SentinelOne inventory": "显示我的 SentinelOne 资产清单中存在漏洞的应用。", "Set up Sentry in this project": "在此项目中配置 Sentry。", "Investigate my most frequent production errors": "调查生产环境中最常出现的错误。", "Configure alerts for my Sentry project": "为我的 Sentry 项目配置警报。", "Triage my open Exabeam cases and tell me what to look at first": "分诊我的未结 Exabeam 事件，并告诉我应该先查看哪些。", "Investigate the highest-risk Exabeam alert from the last 24 hours and give me a verdict": "调查过去 24 小时内风险最高的 Exabeam 警报，并给出结论。", "Find the noisiest Exabeam detection rules and propose tuning": "找出噪声最多的 Exabeam 检测规则，并提出调优建议。", "Build a website for my project and publish it on Spacefast.": "为我的项目构建一个网站，并将其发布到 Spacefast。", "Publish this dashboard and give me a link to share.": "发布此仪表板，并给我一个可分享的链接。", "Update the content and design of my existing Spacefast site.": "更新我现有 Spacefast 网站的内容和设计。", "Set up Supabase Auth and protected routes for my app": "为我的应用配置 Supabase Auth 和受保护的路由。", "Review my Supabase schema and RLS policies for security issues": "检查我的 Supabase 数据库结构和 RLS 策略是否存在安全问题。", "Optimize my Postgres queries and indexes using Supabase best practices": "使用 Supabase 最佳实践优化我的 Postgres 查询和索引。", "I've got an idea for something I'd like to build": "我有一个想要实现的创意。", "Let's figure out why this broke": "一起找出它为什么出故障了。", "Find key decision-makers at [company] and summarize their professional backgrounds.": "查找 [公司] 的主要决策者，并汇总他们的职业背景。", "Research [company], including its products, competitors, and latest news.": "研究 [公司]，包括其产品、竞争对手和最新消息。", "Find the latest documentation and code examples for integrating [API or library] into my project.": "查找将 [API 或库] 集成到我的项目所需的最新文档和代码示例。", "Summarize the cards that are due this week across my Trello boards.": "汇总我的所有 Trello 看板中本周到期的卡片。", "Create a Trello card on my board for each TODO in this file.": "在我的看板中，为此文件中的每个 TODO 创建一张 Trello 卡片。", "Show what is in my Trello Inbox and suggest a board and list for each card.": "显示我的 Trello Inbox 中的内容，并为每张卡片建议合适的看板和列表。", "Set up a tilemap level with rule tiles for my 2D Unity game.": "为我的 2D Unity 游戏创建一个使用规则瓦片的瓦片地图关卡。", "Help me implement in-app purchases and set up ad mediation with LevelPlay.": "帮我实现应用内购买，并使用 LevelPlay 配置广告聚合。", "Set up multiplayer lobbies and networking for my Unity game.": "为我的 Unity 游戏配置多人大厅和网络功能。", "Help me deploy this app to Vercel": "帮我将此应用部署到 Vercel。", "Investigate my latest failed Vercel deployment": "调查我最近一次失败的 Vercel 部署。", "Build an AI agent with the Vercel AI SDK": "使用 Vercel AI SDK 构建一个 AI 智能体。", "Check a file I downloaded before I run it. Ask me for its local path, compute SHA-256 without executing it, and look up its existing VirusTotal report. Do not upload it.": "在我运行下载的文件之前，先帮我检查。询问其本地路径，在不执行文件的情况下计算 SHA-256，并查询现有的 VirusTotal 报告。不要上传文件。", "Help me assess a suspicious link. Explain what a URL lookup shares before asking for it, then retrieve its existing VirusTotal report. Do not open the link or submit it for analysis.": "帮我评估一个可疑链接。先说明网址查询会共享哪些信息，再向我索要链接，然后获取现有的 VirusTotal 报告。不要打开链接或提交分析。", "Investigate an IP address from my logs. Ask for the IP and a brief description of the activity, retrieve its existing VirusTotal report, and explain the evidence and its limits. Do not request a new analysis.": "调查日志中的一个 IP 地址。询问该 IP 和相关活动的简要说明，获取现有的 VirusTotal 报告，并解释证据及其局限。不要请求新的分析。", "What did we decide in yesterday's pricing meeting?": "昨天的定价会议上，我们做了哪些决定？", "Summarize my calls with Acme this month and list open action items.": "汇总我本月与 Acme 的通话，并列出尚未完成的行动项。", "Prep me for my next meeting.": "帮我准备下一场会议。", "Build a headless online store on Wix and release it to Wix hosting": "在 Wix 上构建一个无头在线商店，并将其发布到 Wix 托管服务。", "Add a dashboard page with Wix Design System UI to my Wix app": "使用 Wix Design System UI，为我的 Wix 应用添加一个仪表板页面。", "List my Wix sites and add three products to my store": "列出我的 Wix 网站，并向商店中添加三件商品。", "Review my site’s traffic and suggest what I should publish next.": "分析我的网站流量，并建议下一步应该发布什么内容。", "Update the “Learn more” button on my page to “Book a consultation” and link it to my Contact page.": "将页面上的“了解更多”按钮改为“预约咨询”，并链接到我的“联系我们”页面。", "Draft a blog post announcing 20% off all products this weekend.": "起草一篇博客文章，宣布本周末所有商品享受八折优惠。", "Show me around the Zapier MCP plugin and get me set up": "介绍 Zapier MCP 插件，并帮我完成配置。", "Find a Zapier action that sends a Slack message and try it": "查找一个发送 Slack 消息的 Zapier 操作，并试用它。", "List the Zapier apps I have connected and what actions are available": "列出我已连接的 Zapier 应用及其可用操作。", "Show my open deals in Bigin": "显示我在 Bigin 中尚未结案的交易。", "List my Bigin tasks due this week": "列出我在 Bigin 中本周到期的任务。", "Add a new contact to Bigin": "向 Bigin 添加一个新联系人。", "Write a Deluge function that updates a Deal's stage when its related Task is closed": "编写一个 Deluge 函数，在关联的 Task 关闭时更新 Deal 的阶段。", "Write a COQL query for all open Leads created this month, with their owner names": "编写一条 COQL 查询，查找本月创建且尚未关闭的全部 Leads，并包含其负责人姓名。", "Create a ClientScript that hides the Fax field on Contacts when Lead Source is Web": "创建一个 ClientScript，当 Lead Source 为 Web 时，隐藏 Contacts 上的 Fax 字段。", "Prioritize Zoho Desk ticket 12345 and explain the evidence.": "为 Zoho Desk 工单 12345 确定优先级，并说明依据。", "Review this ticket and recommend High, Medium, or Low priority.": "审阅此工单，并建议将优先级设为高、中或低。", "Triage a ticket and recommend the right support team.": "分诊一张工单，并推荐合适的支持团队。", "Show my open tasks and issues in Zoho Projects.": "显示我在 Zoho Projects 中尚未完成的任务和问题。", "Help me implement a Zoho Projects task or fix an issue in this repository.": "帮我完成一项 Zoho Projects 任务，或修复此仓库中的一个问题。", "Update my task with the changes made and tests performed and log 2 hours today for it.": "将已完成的更改和测试更新到我的任务中，并为该任务记录今天的 2 小时工时。", "List my overdue Zoho Books invoices and summarize what each customer owes": "列出我的 Zoho Books 逾期发票，并汇总每位客户的欠款。", "Show uncategorized bank transactions and suggest matches": "显示未分类的银行交易，并建议匹配项。", "Create an invoice for customer Acme Corp with 10 hours of consulting at 150 per hour": "为客户 Acme Corp 创建一张发票，列出 10 小时咨询服务，每小时收费 150。"};
  const promptTexts=Object.keys(detailPrompts).map(text=>new TextNode(text));
  const promptContainer=new Element('div',promptTexts,{'data-testid':'plugin-suggested-prompt-list'});
  const standalonePermissionAppName=new TextNode('Science');
  const standalonePermissionAppHeader=new Element('span',[standalonePermissionAppName],{'data-testid':'permission-app-header'});
  const permissionHeading=new TextNode('Allow search for codex references?');
  const permissionAppName=new TextNode('Settings');
  const permissionHeader=new Element('div',[new Element('span',[permissionAppName],{'data-testid':'permission-app-header'}),new Element('span',[permissionHeading],{class:'font-medium text-foreground min-w-0 break-words'})],{'data-testid':'ask-question-header-text'});
  const onceOption=new TextNode('Yes, allow this time');
  const conversationOption=new TextNode('Yes, and always allow in this conversation');
  const permissionInput=new Element('textarea',[],{'data-testid':'ask-question-writein',placeholder:'(tell the agent what to do instead)'});permissionInput.value='Do not run anything';
  const permissionTarget=new Element('textarea',[],{'data-testid':'permission-target-editor'});permissionTarget.value='node private-script.js';
  const permissionRawCommand=new TextNode('Run');
  const permissionSelection=new Element('input',[],{type:'radio',value:'1',checked:'checked','data-permission-scope':'once'});
  const permissionSubmit=new TextNode('Submit');
  const permissionCard=new Element('div',[permissionHeader,new Element('div',[onceOption],{'data-testid':'ask-question-option-text'}),new Element('div',[conversationOption],{'data-testid':'ask-question-option-text'}),permissionSelection,new Element('pre',[permissionRawCommand]),permissionTarget,permissionInput,new Element('button',[permissionSubmit],{'data-testid':'interaction-continue-button'})],{class:'outline-none flex flex-col no-focus-ring no-focus-agent-input'});
  const genericQuestionLabel=new TextNode('Yes, allow this time');
  const genericQuestionInput=new Element('textarea',[],{'data-testid':'ask-question-writein',placeholder:'Other (write your answer)'});
  const genericQuestionCard=new Element('div',[new Element('div',[genericQuestionLabel],{'data-testid':'ask-question-option-text'}),genericQuestionInput],{class:'outline-none flex flex-col no-focus-ring no-focus-agent-input'});
  const permissionAgentWrapper=new Element('div',[permissionCard,genericQuestionCard],{'data-testid':'agent-response'});
  const userQuestionLabel=new TextNode('Yes, allow this time');
  const userQuestionCard=new Element('div',[new Element('div',[userQuestionLabel],{'data-testid':'ask-question-option-text'}),new Element('textarea',[],{'data-testid':'ask-question-writein',placeholder:'(tell the agent what to do instead)'})],{class:'outline-none flex flex-col no-focus-ring no-focus-agent-input'});
  const protectedUserWrapper=new Element('div',[userQuestionCard],{'data-testid':'user-message'});
  const userSearchText=new TextNode('Allow search for codex references?');
  const agentSearchText=new TextNode('Allow search for codex references?');
  const genericSearchText=new TextNode('Allow search for codex references?');
  const genericSearchHeader=new Element('div',[new Element('span',[genericSearchText],{class:'font-medium text-foreground min-w-0 break-words'})],{'data-testid':'ask-question-header-text'});
  genericSearchHeader.parentElement=genericQuestionCard;genericQuestionCard.childNodes.push(genericSearchHeader);
  const input=new Element('input',[],{placeholder:'Settings'}); input.value='Run'; input.type='text';
  const timeFixtures=[['now','刚刚'],['just now','刚刚'],['Just now','刚刚'],['justnow','刚刚'],['5m','5 分钟前'],['2h ago','2 小时前'],['3d','3 天前'],['1w ago','1 周前'],['4mo','4 个月前'],['2y','2 年前'],['12s ago','12 秒前'],['5ms','5ms']];
  const timeTexts=timeFixtures.map(([text])=>new TextNode(text));
  const timeElements=timeTexts.map(text=>new Element('span',[text],{'data-screenshot-volatile':'true',class:'text-sm text-foreground opacity-60 min-w-4 shrink-0 text-right tabular-nums'}));
  const timeTitle=new TextNode('5m ago');
  const timeRow=new Element('div',[new Element('span',[timeTitle],{class:'truncate inline-block text-left w-full'}),...timeElements],{'data-testid':'conversation-row-sidebar','data-cascade-id':'example','aria-label':'5m ago'});
  const toolbarTime=new TextNode('just now');
  const toolbar=new Element('div',[new Element('span',[toolbarTime],{'data-screenshot-volatile':'true',class:'text-sm text-muted-foreground select-none px-1 whitespace-nowrap'})],{'data-testid':'cascade-system-message-toolbar'});
  const stepTime=new TextNode('2m ago');
  const stepTimestamp=new Element('div',[new Element('span',[stepTime],{'data-screenshot-volatile':'true',class:'text-xs text-muted-foreground cursor-default px-1 whitespace-nowrap'})],{class:'flex items-center select-none text-xs'});
  const ordinaryNow=new TextNode('now');
  const userActionNow=new TextNode('just now');
  const userActionAgo=new TextNode('2h ago');
  const userBodyAgo=new TextNode('2h ago');
  const userActionCopy=new Element('button',[],{'data-testid':'copy-message-button','aria-label':'Copy Message','data-action':'copy'});
  const userActions=new Element('div',[new Element('span',[userActionNow],{'data-screenshot-volatile':'true',class:'text-sm text-muted-foreground select-none px-1 mr-1 self-center whitespace-nowrap'}),new Element('span',[userActionAgo],{'data-screenshot-volatile':'true',class:'text-sm text-muted-foreground select-none px-1 mr-1 self-center whitespace-nowrap'}),userActionCopy],{'data-testid':'user-message-actions','data-no-scroll-jump':'true'});
  const userStep=new Element('div',[new Element('div',[userBodyAgo],{'data-testid':'user-message'}),userActions],{'data-testid':'user-input-step'});
  const unknownTimestamp=new TextNode('just now');
  const userTimestamp=new TextNode('just now');
  const activityText=new TextNode('Running run final video composition');
  const activityTitle=new Element('span',[activityText],{title:'Running run final video composition',class:'text-muted-foreground truncate min-w-0'});
  const activityButton=new Element('button',[activityTitle],{'data-testid':'tool-group-collapsible','aria-label':'Running run final video composition'});
  const activityRawOutput=new TextNode('Running run final video composition');
  const activityOther=new TextNode('Running Example_Task --name=Sample');
  const activityStatus=new Element('div',[new Element('span',[activityOther],{title:'Running Example_Task --name=Sample',class:'text-muted-foreground truncate min-w-0'})],{'data-testid':'ephemeral-tool-status'});
  const splitStatusPrefix=new TextNode('Running ');
  const splitStatusResource=new TextNode('Reading Report');
  const hiddenStatus=new TextNode('Reading Old Resource');
  const splitStatus=new Element('button',[new Element('span',[new Element('span',[hiddenStatus],{'data-slot-out':'true'}),new Element('span',[splitStatusPrefix],{'data-slot-in':'true'}),new Element('span',[splitStatusResource],{'data-slot-in':'true'})],{class:'text-muted-foreground truncate min-w-0',title:'Running Reading Report'})],{'data-testid':'tool-group-collapsible'});
  const changedFilesText=new TextNode('6 files changed');
  const changedFilesSpan=new Element('span',[changedFilesText],{class:'text-secondary-foreground truncate'});
  const changedFilesHeader=new Element('div',[new Element('div',[changedFilesSpan])],{'data-testid':'changed-files-card-header'});
  const changedFileName=new TextNode('6 files changed');
  const changedFilesCard=new Element('div',[changedFilesHeader,new Element('span',[changedFileName],{'data-testid':'changed-files-card-file'})],{'data-testid':'changed-files-card'});
  const activityUserText=new TextNode('Running run final video composition');
  const runtimeUiFixture=new Element('div',[timeRow,toolbar,stepTimestamp,userStep,new Element('span',[ordinaryNow]),new Element('span',[unknownTimestamp],{'data-screenshot-volatile':'true'}),new Element('div',[new Element('span',[userTimestamp],{'data-screenshot-volatile':'true',class:'text-xs text-muted-foreground cursor-default px-1 whitespace-nowrap'})],{'data-testid':'user-message',class:'flex items-center select-none text-xs'}),new Element('div',[activityButton,activityStatus,splitStatus,changedFilesCard,new Element('pre',[activityRawOutput])],{'data-testid':'agent-response'}),new Element('div',[activityUserText],{'data-testid':'user-message'})]);
  const hiddenBodyText=new TextNode('Waiting for user input');
  const hiddenUserText=new TextNode('Loading media...');
  const errorPrefix=new TextNode('Could not load the app view: '),rawErrorDetail=new TextNode('RAW_ERROR_TEXT');
  const mcpUiError=new Element('div',[errorPrefix,rawErrorDetail],{'data-testid':'mcp-app-view-error'});
  const hiddenToolbarLabel=new TextNode('Expand questionnaire');
  const hiddenToolbar=new Element('button',[hiddenToolbarLabel],{'data-testid':'ask-question-collapse-button','aria-label':'Expand questionnaire','aria-expanded':'false','data-action':'expand'});
  const toolPrefix=new TextNode('Reading');
  const toolContent=new TextNode('Reading Report');
  const toolTitleRow=new Element('div',[new Element('span',[toolPrefix],{class:'text-muted-foreground'}),new Element('span',[toolContent],{class:'truncate text-muted-foreground [&_.text-foreground]:text-muted-foreground',title:'Reading Report'})],{class:'flex flex-row items-center gap-1 overflow-hidden whitespace-nowrap text-muted-foreground'});
  const hiddenToolHeader=new Element('div',[new Element('div',[new Element('span',[toolTitleRow],{class:'truncate'})],{class:'flex min-w-0 items-center gap-x-1'})],{class:'group flex w-full min-w-0 items-center min-h-8 py-1 px-2 select-none transition-[background-color]'});
  const toolWaitText=new TextNode('Waiting for user input');
  const toolWaitLabel=new Element('div',[toolWaitText],{class:'mt-0.5 px-2 h-8 text-muted-foreground select-none flex items-center'});
  const toolCodeText=new TextNode('Reading');
  const formErrorText=new TextNode('Minimum length is 4');
  const formInput=new Element('input',[],{type:'text',placeholder:'Sample_Resource'});formInput.value='DoNotTranslate_Value';
  const form=new Element('form',[formInput,new Element('p',[formErrorText],{class:'text-red-500 text-sm pl-1'})],{class:'flex flex-col gap-1'});
  const multiModelText=new TextNode('3 models selected');
  const multiModelButton=new Element('button',[new Element('span',[multiModelText],{'data-tooltip-id':'model-count-tooltip'})],{'data-testid':'model-selector-trigger','aria-label':'Select model, current: 3 models selected','data-context-window':'default'});
  const customModelName=new TextNode('3 models selected');
  const newBadgeText=new TextNode('New');
  const upperBadgeText=new TextNode('NEW');
  const groupedBadgeText=new TextNode('New');
  const newModelName=new TextNode('Orchestrator (Argon)');
  const newModelRow=new Element('div',[new Element('span',[newModelName],{class:'truncate text-sm text-left'}),new Element('div',[new Element('span',[newBadgeText]),new Element('span',[])],{class:'bg-secondary opacity-70 flex items-center gap-1 rounded-full px-1.5 text-sm'}),new Element('div',[upperBadgeText],{class:'bg-secondary rounded-full px-1.5 text-sm'})],{'data-testid':'model-selector-item','data-model-label':'Orchestrator (Argon)'});
  const groupedModelRow=new Element('div',[new Element('span',[new TextNode('Gemini 4 Hydrogen')],{'data-testid':'model-selector-effort-group','data-model-base':'Gemini 4 Hydrogen'}),new Element('div',[groupedBadgeText],{class:'bg-secondary rounded-full px-1.5 text-sm'})]);
  const createNewText=new TextNode('New');
  const newBadgeFixture=new Element('div',[newModelRow,groupedModelRow,new Element('button',[createNewText])]);
  const customModelButton=new Element('button',[new Element('span',[customModelName])],{'data-testid':'model-selector-trigger','aria-label':'Select model, current: 3 models selected'});
  const rawToolName=new TextNode('Open Terminal');
  const noPrefixTitle=new Element('span',[rawToolName],{class:'truncate text-muted-foreground [&_.text-foreground]:text-muted-foreground',title:'Open Terminal'});
  const noPrefixRow=new Element('div',[noPrefixTitle],{class:'flex flex-row items-center gap-1 overflow-hidden whitespace-nowrap text-muted-foreground'});
  const noPrefixHeader=new Element('div',[new Element('div',[new Element('span',[noPrefixRow],{class:'truncate'})],{class:'flex min-w-0 items-center gap-x-1'})],{class:'group flex w-full min-w-0 items-center min-h-8 py-1 px-2 select-none'});
  const hiddenLineNodes=[new TextNode('… ('),new TextNode('12'),new TextNode(' '),new TextNode('lines'),new TextNode(' above hidden)')];
  const rawTerminalText=new TextNode('12 lines above hidden');
  const hiddenLineMarker=new Element('div',hiddenLineNodes,{class:'text-muted-foreground'});
  const hiddenTerminal=new Element('pre',[new Element('div',[hiddenLineMarker,rawTerminalText])],{class:'max-h-[300px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm'});
  const hiddenAgentUi=new Element('div',[mcpUiError,hiddenToolbar,hiddenToolHeader,noPrefixHeader,toolWaitLabel,new Element('pre',[toolCodeText]),form,multiModelButton,customModelButton,hiddenTerminal,new Element('p',[hiddenBodyText])],{'data-testid':'agent-response'});
  const hiddenTestFixture=new Element('div',[hiddenAgentUi,newBadgeFixture,new Element('div',[hiddenUserText],{'data-testid':'user-message'})]);
  const body=new Element('body',[runtimeUiFixture,hiddenTestFixture,settings,identical,greeting,alternateGreeting,selector,projectDescription,automationNotice,creationNotice,lateCreationNotice,advancedDescription,feedbackType,customizationsEmpty,quotaEmpty,modelNotice,modelUnavailable,viewPlans,noticeFixturesContainer,quotaDetail,quotaPercent,splitQuotaPercent,availableCredits,feedbackDescription,feedbackIdentity,inheritedTooltip,skillRow,additionalContainer,promptContainer,planPrefix,planName,planCombined,eligibility,pluginCard,emptyContainer,standalonePermissionAppHeader,permissionAgentWrapper,protectedUserWrapper,new Element('div',[userText],{'data-testid':'user-message'}),new Element('div',[agentText],{'data-testid':'agent-response'}),new Element('pre',[codeText]),new Element('div',[userSearchText],{'data-testid':'user-message'}),new Element('div',[agentSearchText],{'data-testid':'agent-response'}),input]);
  const observers=[];
  class Observer {constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){}}
  vm.runInNewContext(injected,{window:{location:{protocol:'https:',hostname,pathname:'/customizations'}},document:{body,readyState:'complete',title:'Antigravity',querySelector(){return null;},querySelectorAll(selector){return body.querySelectorAll(selector);}},Node:{TEXT_NODE:3,ELEMENT_NODE:1},MutationObserver:Observer,console});
  if(hostname==='127.0.0.1') {
    assert.equal(settings.textContent,'设置');
    assert.equal(userText.textContent,'Settings');
    assert.equal(agentText.textContent,'Run');
    assert.equal(codeText.textContent,'Run');
    assert.equal(input.value,'Run');
    assert.equal(input.getAttribute('placeholder'),'设置');
    assert.equal(greeting.textContent,'欢迎回来，Test User。我们从哪里继续？');
    assert.equal(alternateGreeting.textContent,'很高兴见到你，Test User。接下来做什么？');
    assert.equal(selector.getAttribute('aria-label'),'选择项目，当前：无项目');
    assert.equal(projectDescription.textContent,'管理工作区资源、智能体设置和权限。');
    assert.equal(automationName.textContent,'Settings');
    assert.equal(automationNotice.textContent,'此项目由 Settings 自动化任务管理，只有删除该自动化任务后才能删除此项目。');
    assert.equal(planPrefix.textContent,'您的计划：');
    assert.equal(planName.textContent,'Antigravity 入门配额');
    assert.equal(planCombined.textContent,'您的计划：Antigravity 入门配额');
    assert.equal(eligibility.textContent,'此账号目前不符合通过 Google AI 计划获得更高请求限额的资格。');
    assert.equal(pluginTitle.textContent,'Science');
    const introTranslations=JSON.parse(fs.readFileSync(path.join(root,'dictionary.json'),'utf8'));
    assert.equal(highlightedIntro.textContent,introTranslations['Read, draft, and edit docs.']);
    assert.equal(emptyState.textContent,'暂无自动化任务');
    assert.equal(creationName.textContent,'Settings');
    assert.ok(creationNotice.textContent.includes('此项目专为 Settings 自动化任务创建。'));
    assert.ok(creationNotice.textContent.includes('在此项目中工作时，还会应用 全局权限'));
    assert.ok(!/Also includes|when working|automation\./.test(creationNotice.textContent));
    assert.equal(learnMore.getAttribute('href'),'https://example.com/permissions');
    assert.equal(learnMore.textContent,'了解更多');
    assert.equal(advancedDescription.textContent,'修改文件和终端工具的权限。');
    assert.equal(feedbackType.textContent,'反馈类型');
    assert.equal(customizationsEmpty.textContent,'当前未启用任何自定义配置。');
    assert.equal(quotaEmpty.textContent,'暂无可用的配额信息。');
    assert.equal(modelNotice.textContent,'提示');
    assert.equal(modelUnavailable.textContent,'不可用');
    assert.equal(viewPlans.textContent,'查看方案');
    const noticeFixtureKeys=Object.keys(noticeFixtures);
    for(let index=0;index<noticeTextNodes.length;index++) assert.equal(noticeTextNodes[index].textContent,noticeFixtures[noticeFixtureKeys[index]],'Model notice '+index);
    assert.ok(quotaDetail.textContent.startsWith('每日配额，'));
    assert.ok(!/limit|resets|in|2h|3m/.test(quotaDetail.textContent));
    assert.equal(quotaPercent.textContent,'45% 可用');
    assert.equal(splitQuotaPercent.textContent,'45% 可用');
    assert.equal(availableCredits.textContent,'可用 AI 积分：100');
    assert.ok(feedbackDescription.textContent.startsWith('请详细描述遇到的问题。'));
    assert.equal(feedbackIdentity.textContent,'以 example@example.com 的身份发送反馈');
    assert.equal(inheritedTooltip.getAttribute('title'),'在此项目中工作时，沿用你的全局权限。');
    assert.equal(skillTitle.textContent,'Science');
    for(let index=0;index<additionalTexts.length;index++) assert.equal(additionalTexts[index].textContent,introTranslations[Object.keys(additionalDictionary)[index]],'Expanded introduction '+index);
    for(let index=0;index<promptTexts.length;index++) assert.equal(promptTexts[index].textContent,introTranslations[Object.keys(detailPrompts)[index]],'Plugin prompt '+index);
    const lateStrong=new Element('strong',[new TextNode('Settings')]);
    lateCreationNotice.childNodes=[new TextNode('This project was created for'),new TextNode(' the '),lateStrong,new TextNode(' automation. '),new TextNode('Also includes'),new TextNode(' '),new Element('span',[new TextNode('Global Permissions')]),new TextNode(' when working '),new TextNode('in this project'),new TextNode('.')];
    for(const node of lateCreationNotice.childNodes) node.parentElement=lateCreationNotice;
    observers[0].callback([{type:'childList',target:lateCreationNotice,addedNodes:lateCreationNotice.childNodes}]);
    assert.equal(lateStrong.textContent,'Settings');
    assert.ok(!/Also includes|when working|automation\./.test(lateCreationNotice.textContent),'Late-mounted project fragments should compose before individual translation');
    for(let index=0;index<timeFixtures.length;index++) assert.equal(timeTexts[index].textContent,timeFixtures[index][1]);
    assert.equal(timeTitle.textContent,'5m ago','Conversation titles must not be treated as timestamps');
    assert.equal(timeRow.getAttribute('aria-label'),'5m ago');
    assert.equal(toolbarTime.textContent,'刚刚');
    assert.equal(stepTime.textContent,'2 分钟前');
    assert.equal(ordinaryNow.textContent,'now');
    assert.equal(userActionNow.textContent,'刚刚');
    assert.equal(userActionAgo.textContent,'2 小时前');
    assert.equal(userBodyAgo.textContent,'2h ago');
    assert.equal(userActionCopy.getAttribute('data-action'),'copy');
    userActionNow.textContent='3m ago';
    observers[0].callback([{type:'characterData',target:userActionNow}]);
    assert.equal(userActionNow.textContent,'3 分钟前');
    const lateUserTime=new TextNode('just now');
    const lateUserLabel=new Element('span',[lateUserTime],{'data-screenshot-volatile':'true',class:'text-sm text-muted-foreground select-none px-1 mr-1 self-center whitespace-nowrap'});
    lateUserLabel.parentElement=userActions;userActions.childNodes.push(lateUserLabel);
    observers[0].callback([{type:'childList',target:userActions,addedNodes:[lateUserLabel]}]);
    assert.equal(lateUserTime.textContent,'刚刚');
    for(let conversation=0;conversation<3;conversation++) {
      const firstMessageTime=new TextNode('just now');
      const firstMessageLabel=new Element('span',[firstMessageTime],{'data-screenshot-volatile':'true',class:'text-sm text-muted-foreground select-none px-1 mr-1 self-center whitespace-nowrap'});
      const firstMessageActions=new Element('div',[firstMessageLabel],{'data-testid':'user-message-actions','data-no-scroll-jump':'true'});
      const firstMessage=new Element('div',[firstMessageActions],{'data-testid':'user-input-step','data-conversation-fixture':String(conversation)});
      firstMessage.parentElement=body;body.childNodes.push(firstMessage);
      observers[0].callback([{type:'childList',target:body,addedNodes:[firstMessage]}]);
      assert.equal(firstMessageTime.textContent,'刚刚','New conversations must translate their first message timestamp');
      firstMessageTime.textContent='2h ago';
      observers[0].callback([{type:'characterData',target:firstMessageTime}]);
      assert.equal(firstMessageTime.textContent,'2 小时前','Timestamps must stay translated as time advances');
    }
    assert.equal(unknownTimestamp.textContent,'just now');
    assert.equal(userTimestamp.textContent,'just now');
    assert.equal(activityText.textContent,'正在运行最终视频合成');
    assert.equal(activityTitle.getAttribute('title'),'正在运行最终视频合成');
    assert.equal(activityButton.getAttribute('aria-label'),'正在运行最终视频合成');
    assert.equal(activityOther.textContent,'正在运行 Example_Task --name=Sample');
    assert.equal(activityRawOutput.textContent,'Running run final video composition');
    assert.equal(activityUserText.textContent,'Running run final video composition');
    assert.equal(splitStatusPrefix.textContent,'正在运行 ');
    assert.equal(splitStatusResource.textContent,'Reading Report');
    assert.equal(hiddenStatus.textContent,'Reading Old Resource');
    assert.equal(changedFilesText.textContent,'6 个文件已更改');
    assert.equal(changedFileName.textContent,'6 files changed');
    for (const [source,expected] of [['1 file changed','1 个文件已更改'],['12 files changed','12 个文件已更改']]) {
      changedFilesText.textContent=source;
      observers[0].callback([{type:'characterData',target:changedFilesText}]);
      assert.equal(changedFilesText.textContent,expected);
    }
    timeTexts[0].textContent='8m';
    observers[0].callback([{type:'characterData',target:timeTexts[0]}]);
    assert.equal(timeTexts[0].textContent,'8 分钟前');
    activityOther.textContent='Searching Example_Resource';
    observers[0].callback([{type:'characterData',target:activityOther}]);
    assert.equal(activityOther.textContent,'正在搜索 Example_Resource');
    const lateTime=new TextNode('just now');
    const lateStep=new Element('div',[new Element('span',[lateTime],{'data-screenshot-volatile':'true',class:'text-xs text-muted-foreground cursor-default px-1 whitespace-nowrap'})],{class:'flex items-center select-none text-xs'});
    lateStep.parentElement=permissionAgentWrapper;permissionAgentWrapper.childNodes.push(lateStep);
    observers[0].callback([{type:'childList',target:permissionAgentWrapper,addedNodes:[lateStep]}]);
    assert.equal(lateTime.textContent,'刚刚');
    const activityWrites=activityText.writes+activityOther.writes+splitStatusPrefix.writes+splitStatusResource.writes;
    for(let index=0;index<10;index++) observers[0].callback([{type:'characterData',target:activityText}]);
    assert.equal(activityText.writes+activityOther.writes+splitStatusPrefix.writes+splitStatusResource.writes,activityWrites,'Repeated UI mutations must not rewrite stable status labels');
    assert.equal(errorPrefix.textContent,'无法加载应用视图：');
    assert.equal(rawErrorDetail.textContent,'RAW_ERROR_TEXT');
    assert.equal(hiddenToolbarLabel.textContent,dictionary['Expand questionnaire']);
    assert.equal(hiddenToolbar.getAttribute('aria-expanded'),'false');
    assert.equal(hiddenToolbar.getAttribute('data-action'),'expand');
    assert.equal(toolPrefix.textContent,'正在读取');
    assert.equal(toolContent.textContent,'Reading Report');
    assert.equal(toolTitleRow.childNodes[1].getAttribute('title'),'Reading Report');
    assert.equal(toolWaitText.textContent,'等待用户输入');
    assert.equal(toolCodeText.textContent,'Reading');
    assert.equal(formErrorText.textContent,'最少输入 4 个字符');
    assert.equal(formInput.value,'DoNotTranslate_Value');
    assert.equal(multiModelText.textContent,'已选择 3 个模型');
    assert.ok(multiModelButton.getAttribute('aria-label').includes('已选择 3 个模型'));
    assert.equal(multiModelButton.getAttribute('data-context-window'),'default');
    assert.equal(customModelName.textContent,'3 models selected');
    assert.equal(rawToolName.textContent,'Open Terminal');
    assert.equal(newBadgeText.textContent,'新增');
    assert.equal(upperBadgeText.textContent,'新增');
    assert.equal(groupedBadgeText.textContent,'新增');
    assert.equal(createNewText.textContent,dictionary.New);
    assert.equal(newModelName.textContent,'Orchestrator (Argon)');
    assert.equal(newModelRow.getAttribute('data-model-label'),'Orchestrator (Argon)');
    assert.equal(noPrefixTitle.getAttribute('title'),'Open Terminal');
    assert.equal(hiddenLineMarker.textContent,'…（上方已隐藏 12 行）');
    assert.equal(rawTerminalText.textContent,'12 lines above hidden');
    assert.equal(hiddenBodyText.textContent,'Waiting for user input');
    assert.equal(hiddenUserText.textContent,'Loading media...');
    const stableHiddenWrites=toolPrefix.writes+toolWaitText.writes+formErrorText.writes+hiddenLineNodes.reduce((sum,node)=>sum+node.writes,0);
    for(let index=0;index<10;index++)observers[0].callback([{type:'characterData',target:formErrorText}]);
    assert.equal(toolPrefix.writes+toolWaitText.writes+formErrorText.writes+hiddenLineNodes.reduce((sum,node)=>sum+node.writes,0),stableHiddenWrites,'Hidden UI observer must not rewrite stable labels');
    formErrorText.textContent='Maximum length is 20';
    observers[0].callback([{type:'characterData',target:formErrorText}]);
    assert.equal(formErrorText.textContent,'最多输入 20 个字符');
    const localizedNotices=noticeTextNodes.map(node=>node.textContent);
    for(const node of noticeTextNodes)observers[0].callback([{type:'characterData',target:node}]);
    assert.deepEqual(noticeTextNodes.map(node=>node.textContent),localizedNotices,'Translated labels must remain stable when resource names start with Open or Copy');
    assert.equal(permissionHeading.textContent,'允许搜索 codex references 吗？');
    for(const [source,expected] of [
      ['Allow search for antigravity references?','允许搜索 antigravity references 吗？'],
      ['Save rule to always allow search for codex references?','保存规则以始终允许搜索 codex references 吗？'],
      ['Allow search for Codex References 2.0 (local)/中文目录?','允许搜索 Codex References 2.0 (local)/中文目录 吗？'],
      ['Allow search files in codex references?','Allow search files in codex references?'],
      ['Allow rg -n "codex" .?','Allow rg -n "codex" .?']
    ]) {
      permissionHeading.textContent=source;
      observers[0].callback([{type:'characterData',target:permissionHeading}]);
      assert.equal(permissionHeading.textContent,expected,'Dynamic permission heading: '+source);
    }
    assert.equal(userSearchText.textContent,'Allow search for codex references?');
    assert.equal(agentSearchText.textContent,'Allow search for codex references?');
    assert.equal(genericSearchText.textContent,'Allow search for codex references?');
    assert.equal(onceOption.textContent,'是，仅允许这一次');
    assert.equal(conversationOption.textContent,'是，并在此会话中始终允许');
    assert.equal(permissionInput.getAttribute('placeholder'),'（告诉智能体应改做什么）');
    assert.equal(permissionInput.value,'Do not run anything');
    assert.equal(permissionTarget.value,'node private-script.js');
    assert.equal(permissionRawCommand.textContent,'Run');
    assert.equal(permissionAppName.textContent,'Settings');
    assert.equal(standalonePermissionAppName.textContent,'Science');
    assert.deepEqual(permissionSelection.attributes,{type:'radio',value:'1',checked:'checked','data-permission-scope':'once'});
    assert.equal(permissionSubmit.textContent,'提交');
    assert.equal(genericQuestionLabel.textContent,'Yes, allow this time');
    assert.equal(genericQuestionInput.getAttribute('placeholder'),'Other (write your answer)');
    assert.equal(userQuestionLabel.textContent,'Yes, allow this time');
    const latePermissionOption=new TextNode('Yes, allow downloads from example.com for this run');
    const latePermissionElement=new Element('div',[latePermissionOption],{'data-testid':'ask-question-option-text'});latePermissionElement.parentElement=permissionCard;permissionCard.childNodes.push(latePermissionElement);
    observers[0].callback([{type:'childList',target:permissionCard,addedNodes:[latePermissionElement]}]);
    assert.equal(latePermissionOption.textContent,'是，仅本次运行允许从 example.com 下载');
    const lateHoverText=new TextNode('Yes, allow this time');const lateHover=new Element('div',[lateHoverText],{'data-testid':'ask-question-option-hover-card'});lateHover.parentElement=permissionAgentWrapper;permissionAgentWrapper.childNodes.push(lateHover);
    observers[0].callback([{type:'childList',target:permissionAgentWrapper,addedNodes:[lateHover]}]);
    assert.equal(lateHoverText.textContent,'是，仅允许这一次');
    const automationStrong=automationNotice.childNodes.find(node=>node.tagName==='STRONG');
    const rerenderedName=new TextNode('Settings'); rerenderedName.parentElement=automationStrong; automationStrong.childNodes=[rerenderedName];
    observers[0].callback([{type:'characterData',target:rerenderedName}]);
    assert.equal(rerenderedName.textContent,'Settings');
    for(let i=0;i<10;i++) observers[0].callback([{type:'characterData',target:identical}]);
    assert.equal(identical.writes,0,'Same-text writes may create an observer loop');
    assert.equal(settings.writes,1);
  } else {
    assert.equal(settings.textContent,'Settings');
    assert.equal(observers.length,0);
  }
}
scenario('127.0.0.1');
scenario('example.com');
console.log('UI localization regression checks passed.');
