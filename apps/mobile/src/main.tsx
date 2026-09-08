import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { fingerprint, identity, pairingSchema, ready, type Pairing } from '@dsh-mobile/protocol';
import { MobileConnection, type ConnectionState } from './connection.js';
import { loadHost, saveHost, type SavedHost } from './storage.js';
import './style.css';
import { recoverWindow } from './history.js';

interface Workspace { id: string; title: string }
interface Session { sessionId: string; title: string; running: boolean }
interface Row { seq: number; endSeq: number; type: string; text: string; requestId?: string; status?: 'running' | 'completed' | 'failed' | 'cancelled' }
interface Page { snapshot?: boolean; cursor?: number; records: Row[]; hasMore: boolean }
interface Interaction { id: string; sessionId: string; kind: 'approval' | 'question'; toolName?: string; reason?: string; questions?: { id: string; question: string; detail?: string; multiSelect?: boolean; options?: { label: string }[] }[] }
interface Submission { id: string; sessionId: string; text: string; state: 'pending' | 'accepted' | 'uncertain' | 'failed' }
const labels: Record<ConnectionState, string> = { connecting: '正在连接电脑', confirming: '等待电脑确认', connected: '已加密连接', offline: '电脑离线 · 自动重连', denied: '连接被拒绝 · 请检查授权并重新配对', stopped: '未连接' };
function App() {
  const [host, setHost] = useState<SavedHost>(); const [pair, setPair] = useState<Pairing>();
  const [name, setName] = useState('我的手机'); const [state, setState] = useState<ConnectionState>('stopped');
  const [error, setError] = useState(''); const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState(''); const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState(''); const [rows, renderRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null); const followBottom = useRef(true);
  function setRows(value: Row[] | ((old: Row[]) => Row[])) { rowsRef.current = typeof value === 'function' ? value(rowsRef.current) : value; renderRows(rowsRef.current); }
  const [hasMore, setHasMore] = useState(false); const [draft, setDraft] = useState('');
  const [interactions, setInteractions] = useState<Interaction[]>([]); const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (followBottom.current && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; }, [rows, submissions, interactions]);
  const conn = useRef<MobileConnection | undefined>(undefined); const sessionRef = useRef(''); const workspaceRef = useRef(''); const cursor = useRef(0);
  useEffect(() => { void (async () => {
    try {
      await ready;
      const fragment = new URLSearchParams(location.hash.slice(1)).get('pair');
      history.replaceState(null, '', location.pathname);
      if (fragment) {
        const value = pairingSchema.parse(JSON.parse(fragment));
        if (value.expiresAt <= Date.now()) throw new Error('二维码已过期，请在电脑重新生成');
        const valueHost = { hostId: value.hostId, hostKey: value.hostKey, relayUrl: value.relayUrl, identity: identity(), name: '我的手机' };
        setPair(value); setHost(valueHost);
      } else {
        const saved = await loadHost(); if (saved) { setHost(saved); setName(saved.name); connect(saved); }
      }
    } catch { setError('无法读取配对信息。请在电脑生成新的二维码，并允许浏览器保存设备信息。'); }
  })(); return () => conn.current?.stop(); }, []);
  function connect(value: SavedHost, pairing?: Pairing) {
    conn.current?.stop();
    const client = new MobileConnection(value, pairing); conn.current = client;
    client.onPaired = async () => { await saveHost(value); setPair(undefined); };
    client.onState = status => {
      setState(status);
      if (status === 'connected') void refresh(client);
      if (status === 'offline' || status === 'denied') setSubmissions(old => old.map(s => s.state === 'pending' ? { ...s, state: 'uncertain' } : s));
    };
    let eventQueue = Promise.resolve();
    client.onEvent = event => { eventQueue = eventQueue.then(async () => {
      if (event.sessionId !== sessionRef.current) return;
      if (event.topic === 'history') {
        let page = event.data as Page;
        if (page.snapshot) {
          page = { ...page, ...await recoverWindow(rowsRef.current, page, beforeSeq => client.call<Page>('sessions.history', { sessionId: event.sessionId, throughSeq: page.cursor, beforeSeq })) };
          if (event.sessionId !== sessionRef.current) return;
        }
        setRows(old => {
          if (page.snapshot) { cursor.current = page.cursor ?? 0; setHasMore(page.hasMore); return page.records; }
          const last = old.at(-1)?.endSeq ?? -1;
          const fresh = page.records.filter(r => r.endSeq > last);
          if (fresh[0] && fresh[0].seq !== last + 1 && old.length) { setError('正在重新同步会话历史'); void client.call('sessions.watch', { sessionId: sessionRef.current }); return old; }
          return [...old, ...fresh];
        });
        const received = new Set(page.records.flatMap(r => r.requestId ? [r.requestId] : []));
        setSubmissions(old => old.filter(s => !received.has(s.id)));
      } else if (event.topic === 'interactions') setInteractions(event.data as Interaction[]);
      else setError('会话输出需要在电脑查看，或返回任务列表后重新同步。');
    }).catch(e => setError(message(e))); };
    client.start();
  }
  async function refresh(client = conn.current) {
    if (!client) return;
    try {
      const items = await client.call<Workspace[]>('workspaces.list'); setWorkspaces(items);
      const selected = items.find(w => w.id === workspaceRef.current)?.id ?? items[0]?.id ?? '';
      setWorkspace(selected); workspaceRef.current = selected;
      if (selected) setSessions(await client.call<Session[]>('sessions.list', { workspaceId: selected }));
      else { setSessions([]); setSession(''); sessionRef.current = ''; }
      if (sessionRef.current && selected) await client.call('sessions.watch', { sessionId: sessionRef.current });
    } catch (e) { setError(message(e)); }
  }
  async function selectWorkspace(id: string) {
    if (sessionRef.current) void conn.current?.call('sessions.unwatch', { sessionId: sessionRef.current }).catch(() => {});
    sessionRef.current = ''; setSession(''); workspaceRef.current = id; setWorkspace(id); setRows([]); setInteractions([]);
    try { setSessions(await conn.current!.call('sessions.list', { workspaceId: id })); } catch (e) { setError(message(e)); }
  }
  async function openSession(id: string) {
    sessionRef.current = id; setSession(id); setRows([]); setHasMore(false); setInteractions([]); setError(''); followBottom.current = true;
    try { await conn.current!.call('sessions.watch', { sessionId: id }); } catch (e) { setError(message(e)); }
  }
  async function createSession() {
    setBusy(true);
    try { const result = await conn.current!.call<{ sessionId: string }>('sessions.create', { workspaceId: workspace }); await refresh(); await openSession(result.sessionId); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function submit(value?: Submission) {
    if (!draft.trim() && !value) return;
    const current = value ?? { id: crypto.randomUUID(), sessionId: session, text: draft.trim(), state: 'pending' as const };
    setSubmissions(old => value ? old.map(s => s.id === value.id ? { ...s, state: 'pending' } : s) : [...old, current]); if (!value) setDraft('');
    try {
      await conn.current!.call('sessions.send', { sessionId: current.sessionId, text: current.text }, current.id);
      setSubmissions(old => old.map(s => s.id === current.id ? { ...s, state: 'accepted' } : s));
    } catch (e) {
      setSubmissions(old => old.map(s => s.id === current.id ? { ...s, state: message(e) === 'RESULT_UNCERTAIN' ? 'uncertain' : 'failed' } : s)); setError(message(e));
    }
  }
  async function answer(item: Interaction, value: unknown) {
    try { await conn.current!.call('interactions.answer', { sessionId: item.sessionId, interactionId: item.id, answer: value }); }
    catch (e) { setError(message(e)); }
  }
  async function older() {
    setBusy(true);
    try {
      const page = await conn.current!.call<Page>('sessions.history', { sessionId: session, throughSeq: cursor.current, beforeSeq: rows[0]?.seq });
      if (sessionRef.current !== session) return;
      followBottom.current = false;
      setRows(old => [...page.records.filter(r => !old.some(o => o.seq === r.seq)), ...old]); setHasMore(page.hasMore);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function forget() { conn.current?.stop(); await saveHost(); setHost(undefined); setPair(undefined); setRows([]); setSession(''); sessionRef.current = ''; setState('stopped'); }
  const messages = transcript(rows);
  const connected = state === 'connected';
  const taskStatus = rows.findLast(r => r.status)?.status;
  const taskLabel = taskStatus ? { running: '正在运行', completed: '已完成', failed: '执行失败', cancelled: '已停止' }[taskStatus] : '与电脑保持同步';
  return <main className="app">
    <header className="top"><a className="brand" href="/">DSH<span>pocket</span></a><span className={'connection ' + (connected ? 'online' : '')}><i/>{labels[state]}</span></header>
    {error && <div className="notice" role="alert">{error}<button aria-label="关闭提示" onClick={() => setError('')}>×</button></div>}
    {!host ? <section className="welcome"><span className="eyebrow">YOUR WORK, WITH YOU</span><h1>离开桌面，<br/>继续思考。</h1><p>在电脑的 DSH 中打开「手机连接」，<br/>扫描二维码，继续你的任务。</p><div className="pair-symbol">↗</div><p className="muted">无需账号 · 设备独立授权 · 加密连接</p></section>
    : pair && !connected ? <section className="card pair-card"><span className="eyebrow">连接你的电脑</span><h1>让任务随身</h1><label>设备名称<input value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label><p>点击连接，然后在电脑上确认以下校验码一致。</p><code className="fingerprint">{fingerprint(host.hostKey, host.identity.publicKey)}</code><button className="primary" disabled={state === 'confirming' || state === 'connecting' || !name.trim()} onClick={() => connect({ ...host, name: name.trim() }, pair)}>连接并申请配对</button><p className="muted">{labels[state]}</p><button className="text-button" onClick={forget}>取消配对</button></section>
    : <>
      {!session ? <section className="tasks"><div className="heading"><div><span className="eyebrow">WORKSPACE</span><h1>你的任务</h1></div><button className="icon" aria-label="刷新任务" onClick={() => refresh()} disabled={!connected}>↻</button></div>
        <select aria-label="工作区" value={workspace} disabled={!connected} onChange={e => void selectWorkspace(e.target.value)}>{!workspaces.length && <option value="">尚未共享工作区</option>}{workspaces.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select>
        <button className="primary new-task" onClick={createSession} disabled={!connected || !workspace || busy}>＋ 新建任务</button>
        {!sessions.length && <div className="empty"><span>◇</span><h2>{workspace ? '从一个问题开始' : '等待电脑共享工作区'}</h2><p>{workspace ? '创建任务，或从电脑继续已有会话。' : '在电脑端选择允许手机访问的工作区。'}</p></div>}
        <div className="session-list">{sessions.map(s => <button className="session" key={s.sessionId} onClick={() => openSession(s.sessionId)} disabled={!connected}><span><strong>{s.title}</strong><small>{s.running ? '正在运行' : '可继续'}</small></span><b>↗</b></button>)}</div>
        <footer><button className="text-button" onClick={forget}>忘记此电脑</button><span>ALPHA · 加密会话</span></footer>
      </section> : <section className="conversation">
        <div className="conversation-head"><button className="icon" aria-label="返回任务" onClick={() => { void conn.current?.call('sessions.unwatch', { sessionId: session }).catch(() => {}); setSession(''); sessionRef.current = ''; void refresh(); }}>←</button><div><strong>{sessions.find(s => s.sessionId === session)?.title ?? '新任务'}</strong><small>{interactions.length ? '需要你确认' : connected ? taskLabel : '恢复连接后补齐进度'}</small></div><button className="stop" disabled={!connected} onClick={() => void conn.current!.call('sessions.cancel', { sessionId: session }).catch(e => setError(message(e)))}>停止</button></div>
        <div className="messages" aria-live="polite" ref={messagesRef} onScroll={e => { const box = e.currentTarget; followBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 96; }}>{hasMore && <button className="text-button" disabled={busy || !connected} onClick={older}>加载更早消息</button>}
        {!messages.length && <div className="empty"><span>✳</span><h2>从这里继续</h2><p>任务在电脑上执行，手机是你的随身窗口。</p></div>}
        {messages.map((m, i) => <article className={'message ' + m.role} key={i}><small>{m.role === 'user' ? '你' : 'DSH'}</small><div>{m.text}</div></article>)}
        {submissions.filter(s => s.sessionId === session).map(s => <article className="message user pending" key={s.id}><small>{s.state === 'pending' ? '待确认' : s.state === 'accepted' ? '电脑已接收' : s.state === 'uncertain' ? '发送结果待核对' : '发送失败'}</small><div>{s.text}</div>{s.state === 'uncertain' && <button disabled={!connected} onClick={() => submit(s)}>核对这次提交</button>}</article>)}
        {interactions.map(item => <InteractionCard key={item.id} item={item} disabled={!connected} onAnswer={value => answer(item, value)}/>)}</div>
        <form className="composer" onSubmit={e => { e.preventDefault(); void submit(); }}><textarea aria-label="发送消息" placeholder={connected ? '给任务一个新方向…' : '连接恢复后可发送'} value={draft} maxLength={32000} rows={2} onChange={e => setDraft(e.target.value)}/><button className="send" aria-label="发送" disabled={!connected || !draft.trim()}>↑</button></form>
      </section>}
    </>}
  </main>;
}
function InteractionCard({ item, disabled, onAnswer }: { item: Interaction; disabled: boolean; onAnswer: (value: unknown) => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({}); const [custom, setCustom] = useState<Record<string, string>>({});
  return <section className="interaction"><span className="eyebrow">需要你确认</span>{item.kind === 'approval' ? <><h2>{item.toolName}</h2><p>{item.reason ?? '此工具请求执行权限，请核对电脑上的完整操作内容。'}</p><div className="actions"><button disabled={disabled} onClick={() => onAnswer('rejected')}>拒绝</button><button className="primary" disabled={disabled} onClick={() => onAnswer('allowed-once')}>仅允许一次</button></div></> : <form onSubmit={e => { e.preventDefault(); onAnswer({ answers: item.questions?.map(q => ({ id: q.id, selected: answers[q.id] ?? [], ...(custom[q.id]?.trim() ? { custom: custom[q.id]!.trim() } : {}) })) }); }}>
    {item.questions?.map(q => <fieldset key={q.id}><legend>{q.question}</legend>{q.detail && <p>{q.detail}</p>}{q.options?.map(o => <label className="option" key={o.label}><input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.id} checked={answers[q.id]?.includes(o.label) ?? false} onChange={e => setAnswers(old => ({ ...old, [q.id]: q.multiSelect ? e.target.checked ? [...(old[q.id] ?? []), o.label] : (old[q.id] ?? []).filter(v => v !== o.label) : [o.label] }))}/>{o.label}</label>)}<input aria-label={q.question + ' 补充回答'} placeholder="或输入你的回答" value={custom[q.id] ?? ''} onChange={e => setCustom(old => ({ ...old, [q.id]: e.target.value }))}/></fieldset>)}<button className="primary" disabled={disabled}>提交回答</button></form>}</section>;
}
function transcript(rows: Row[]): { role: 'user' | 'assistant'; text: string }[] {
  const result: { role: 'user' | 'assistant'; text: string }[] = []; let live = false;
  for (const row of rows) {
    if (!row.text) continue;
    if (row.type === 'user/message') { result.push({ role: 'user', text: row.text }); live = false; }
    else if (row.type === 'assistant/message') { if (live) result.pop(); result.push({ role: 'assistant', text: row.text }); live = false; }
    else { if (!live) result.push({ role: 'assistant', text: '' }); result[result.length - 1]!.text += row.text; live = true; }
  }
  return result;
}
function message(error: unknown): string { return error instanceof Error ? error.message : '操作失败'; }
createRoot(document.getElementById('root')!).render(<App/>);
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js');
