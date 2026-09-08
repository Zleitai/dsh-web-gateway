export const adminHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH · 手机连接</title><style>
body{font:16px system-ui;background:#f4f5f2;color:#1d302a;margin:0}main{max-width:850px;margin:40px auto;padding:24px}section{background:white;border:1px solid #dce3df;border-radius:16px;padding:24px;margin:20px 0}h1{font-size:32px}h2{font-size:20px}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #bbc9c1;margin:5px}button{background:#174c3d;color:white;cursor:pointer}label{display:block;margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}#qr img{max-width:260px}small{color:#65786e}.row{display:flex;align-items:center;flex-wrap:wrap;gap:12px}#message{color:#a13723}</style>
<main><small>DSH MOBILE CONTROL · ALPHA</small><h1>把任务带到手机上</h1><p>共享工作区，扫码配对，在手机上继续当前任务。</p><p id="status"></p><p id="message" role="status"></p>
<section><h2>1. 连接中转</h2><form id="register"><label>测试邀请码 <input id="invite" type="password" autocomplete="off"></label><button>注册此电脑并连接</button></form><small>中转地址由插件配置提供；自托管可留空邀请码。</small></section>
<section><h2>2. 共享工作区</h2><div id="workspaces"></div><button id="share">保存共享范围</button><p><small>手机能在这些工作区继续或创建任务。任务内的工具权限仍由 DSH 控制。</small></p></section>
<section><h2>3. 配对手机</h2><button id="pair">生成五分钟二维码</button><div id="qr"></div><p id="pairlink"></p><div id="pending"></div></section>
<section><h2>已授权设备</h2><div id="devices"></div></section><section><h2>等待处理的请求</h2><div id="interactions"></div><small>也可在原 DSH 会话界面回答；第一次有效回答生效。</small></section>
</main><script src="/mobile-control/app.js"></script></html>`;

export const adminJs = `
const $=id=>document.getElementById(id);
const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n};
async function api(action,data={}){const r=await fetch('/mobile-control/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...data})});const b=await r.json();if(!r.ok)throw new Error(b.error||'操作失败');return b}
async function act(action,data){try{$('message').textContent='';const result=await api(action,data);await refresh();return result}catch(e){$('message').textContent=e.message}}
function button(label,fn){const b=text('button',label);b.onclick=fn;return b}
let initialized=false;
async function refresh(){try{
const r=await fetch('/mobile-control/api');if(!r.ok)throw new Error('请先在同一浏览器登录 DSH，再打开此页面');
const s=await r.json();$('status').textContent=s.error||('中转状态：'+s.state);
if(!initialized){$('workspaces').replaceChildren(...s.workspaces.map(w=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=w.id;c.checked=s.shared.includes(w.id);l.append(c,text('span',w.title+' · '+w.path));return l}));initialized=true}
$('devices').replaceChildren(...s.devices.map(d=>{const n=text('p',d.name+' ');n.append(button('撤销',()=>act('revoke',{id:d.id})));return n}));
$('pending').replaceChildren(...s.pending.map(p=>{const n=text('div',p.name);n.append(text('pre',p.fingerprint),button('确认配对',()=>act('confirm',{id:p.id,allowed:true})),button('拒绝',()=>act('confirm',{id:p.id,allowed:false})));return n}));
$('interactions').replaceChildren(...s.interactions.map(p=>{const n=text('div',p.kind==='approval'?'工具审批：'+p.toolName:'等待回答');n.append(text('pre',p.reason||JSON.stringify(p.questions)));if(p.kind==='approval')n.append(button('仅允许一次',()=>act('answer',{sessionId:p.sessionId,id:p.id,answer:'allowed-once'})),button('拒绝',()=>act('answer',{sessionId:p.sessionId,id:p.id,answer:'rejected'})));return n}));
}catch(e){$('message').textContent=e.message}}
$('register').onsubmit=async e=>{e.preventDefault();await act('register',{invite:$('invite').value});$('invite').value=''};
$('share').onclick=()=>act('share',{ids:[...$('workspaces').querySelectorAll('input:checked')].map(x=>x.value)});
$('pair').onclick=async()=>{const p=await act('pair');if(!p)return;const img=document.createElement('img');img.src=p.qr;img.alt='手机配对二维码';$('qr').replaceChildren(img);const a=text('a','打开手机配对页');a.href=p.url;a.target='_blank';a.rel='noreferrer';$('pairlink').replaceChildren(a);setTimeout(()=>{$('qr').replaceChildren();$('pairlink').replaceChildren()},300000)};
refresh();setInterval(refresh,2000);
`;
